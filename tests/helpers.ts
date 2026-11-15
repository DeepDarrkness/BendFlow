import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createConnection, type Socket } from 'node:net';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { TestContext } from 'node:test';
import { availablePort } from '../src/worker.ts';
import { CPU_ARGS } from '../src/runtime.ts';
import { CONTRACT, encodeFrame, FrameDecoder, type Frame } from '../src/protocol/framing.ts';

export const executable = resolve('build/echo-worker');

export async function bounded<T>(promise: Promise<T>, ms = 2000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Test deadline exceeded (${ms}ms)`)), ms);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}

export function assertGone(pid: number): void {
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
}

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
  const child = spawn(executable, [...CPU_ARGS, String(port)], { stdio: 'ignore' });
  const exited = Promise.withResolvers<void>();
  let failed: Error | undefined;
  child.on('error', error => { failed = error; });
  child.once('close', () => exited.resolve());
  let peer: NativePeer | undefined;
  t.after(async () => {
    peer?.socket.destroy();
    child.kill('SIGKILL');
    await bounded(exited.promise);
    if (child.pid) assertGone(child.pid);
  });
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    if (failed) throw failed;
    if (child.exitCode !== null) throw new Error(`Native worker exited: ${child.exitCode}`);
    const socket = createConnection({ host: '127.0.0.1', port });
    const connected = await bounded(new Promise<boolean>(resolve => {
      socket.once('connect', () => resolve(true));
      socket.once('error', () => resolve(false));
    }));
    if (connected) {
      peer = new NativePeer(socket);
      return peer;
    }
    socket.destroy();
    await delay(10);
  }
  throw new Error('Native worker did not listen before test deadline');
}
