import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createConnection, type Socket } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import type { TestContext } from 'node:test';
import { availablePort } from '../../src/worker.ts';
import { CPU_ARGS } from '../../src/runtime.ts';
import { PROJECT_ROOT } from '../../src/paths.ts';
import { CONTRACT, encodeFrame, FrameDecoder, type Frame } from '../../src/protocol/framing.ts';
import { bounded } from './deadlines.ts';
import { assertGone, cleanupPriority, resources } from './resources.ts';
import { executable } from './native.ts';

export class NativePeer {
  readonly socket: Socket;
  readonly closed = Promise.withResolvers<void>();
  #frames: Frame[] = [];
  #pending: ReturnType<typeof Promise.withResolvers<Frame>> | undefined;
  #error: Error | undefined;

  constructor(socket: Socket) {
    this.socket = socket;
    const decoder = new FrameDecoder();
    socket.setNoDelay(true);
    socket.on('data', chunk => {
      try {
        decoder.push(chunk, frame => {
          if (this.#pending) {
            this.#pending.resolve(frame);
            this.#pending = undefined;
          } else this.#frames.push(frame);
        });
      } catch (error) { socket.destroy(error instanceof Error ? error : new Error(String(error))); }
    });
    socket.on('error', error => {
      this.#error = error;
      this.#pending?.reject(error);
      this.#pending = undefined;
    });
    socket.on('close', () => {
      this.#error ??= new Error('Peer closed');
      this.#pending?.reject(this.#error);
      this.#pending = undefined;
      this.closed.resolve();
    });
  }

  async receive(): Promise<Frame> {
    const frame = this.#frames.shift();
    if (frame) return frame;
    if (this.#error) throw this.#error;
    assert.equal(this.#pending, undefined);
    this.#pending = Promise.withResolvers<Frame>();
    return bounded(this.#pending.promise);
  }

  async handshake(): Promise<void> {
    this.socket.write(encodeFrame({ kind: 1, requestId: 0, operationId: 0, payload: CONTRACT }));
    assert.deepEqual(await this.receive(), { kind: 2, requestId: 0, operationId: 0, payload: CONTRACT });
  }
}

export async function nativePeer(t: TestContext): Promise<NativePeer> {
  const port = await availablePort();
  const child = spawn(executable, [...CPU_ARGS, String(port)], { stdio: 'ignore', cwd: PROJECT_ROOT });
  const exited = Promise.withResolvers<void>();
  let failed: Error | undefined;
  child.on('error', error => { failed = error; });
  child.once('close', () => exited.resolve());
  resources(t).add(cleanupPriority.native, async () => {
    child.kill('SIGKILL');
    await bounded(exited.promise);
    if (child.pid) assertGone(child.pid);
  });
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    if (failed) throw failed;
    if (child.exitCode !== null) throw new Error(`Native worker exited: ${child.exitCode}`);
    const socket = createConnection({ host: '127.0.0.1', port });
    resources(t).add(cleanupPriority.peer, async () => {
      const closed = new Promise<void>(resolve => socket.once('close', resolve));
      if (socket.closed) return;
      socket.destroy();
      await bounded(closed);
    });
    const connected = await bounded(new Promise<boolean>(resolve => {
      socket.once('connect', () => resolve(true));
      socket.once('error', () => resolve(false));
    }));
    if (connected) {
      return new NativePeer(socket);
    }
    socket.destroy();
    await delay(10);
  }
  throw new Error('Native worker did not listen before test deadline');
}
