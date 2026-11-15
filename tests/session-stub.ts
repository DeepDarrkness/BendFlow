import { createServer, type Socket } from 'node:net';
import { resolve } from 'node:path';
import type { TestContext } from 'node:test';
import { encodeFrame, FrameDecoder, type Frame } from '../src/protocol/framing.ts';
import { SESSION_CONTRACT } from '../src/protocol/session.ts';
import { bounded } from './helpers.ts';

export async function sessionStub(t: TestContext, onCommand: (frame: Frame, socket: Socket) => void = () => {}) {
  const commands: Frame[] = [];
  const arrived = Promise.withResolvers<Frame>();
  const sockets = new Set<Socket>();
  const server = createServer(socket => {
    sockets.add(socket);
    socket.on('error', () => {});
    socket.once('close', () => sockets.delete(socket));
    const decoder = new FrameDecoder();
    socket.on('data', chunk => decoder.push(chunk, frame => {
      if (frame.kind === 1) {
        socket.write(encodeFrame({ kind: 2, requestId: 0, operationId: 0, payload: Buffer.from(SESSION_CONTRACT, 'ascii') }));
      } else {
        commands.push(frame);
        arrived.resolve(frame);
        onCommand(frame, socket);
      }
    }));
  });
  await bounded(new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  }));
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await bounded(new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected fixture port');
  return {
    worker: { executable: resolve('tests/fixtures/idle-worker.mjs'), port: address.port, callMs: 500 },
    commands, arrived: arrived.promise,
  };
}
