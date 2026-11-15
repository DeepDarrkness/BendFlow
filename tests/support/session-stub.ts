import type { Socket } from 'node:net';
import type { TestContext } from 'node:test';
import { encodeFrame, FrameDecoder, type Frame } from '../../src/protocol/framing.ts';
import { SESSION_CONTRACT } from '../../src/protocol/session.ts';
import { projectPath } from '../../src/paths.ts';
import { fixtureServer } from './servers.ts';

export async function sessionStub(t: TestContext, onCommand: (frame: Frame, socket: Socket) => void = () => {}) {
  const commands: Frame[] = [];
  const arrived = Promise.withResolvers<Frame>();
  const port = await fixtureServer(t, socket => {
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
  return {
    worker: { executable: projectPath('tests/fixtures/idle-worker.mjs'), port, callMs: 500 },
    commands, arrived: arrived.promise,
  };
}
