import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer, type Socket } from 'node:net';
import { resolve } from 'node:path';
import test, { type TestContext } from 'node:test';
import { CONTRACT, encodeFrame, FrameDecoder } from '../src/protocol/framing.ts';
import { BendWorker, type WorkerOptions } from '../src/worker.ts';
import { assertGone, bounded, executable } from './helpers.ts';

const idle = resolve('tests/fixtures/idle-worker.mjs');

async function rejectsStartup(options: WorkerOptions, message: RegExp): Promise<void> {
  const childrenPath = `/proc/self/task/${process.pid}/children`;
  const before = readFileSync(childrenPath, 'utf8').trim();
  await assert.rejects(bounded(BendWorker.start(options)), message);
  assert.equal(readFileSync(childrenPath, 'utf8').trim(), before, 'Startup failure must leave no new child process');
}

async function start(t: TestContext, callMs = 500): Promise<BendWorker> {
  const worker = await BendWorker.start({ executable, callMs });
  t.after(async () => { await bounded(worker.close()); assertGone(worker.pid); });
  return worker;
}

async function fixtureServer(t: TestContext, onConnection: (socket: Socket) => void): Promise<number> {
  const sockets = new Set<Socket>();
  const server = createServer(socket => {
    sockets.add(socket);
    socket.on('error', () => {});
    socket.once('close', () => sockets.delete(socket));
    onConnection(socket);
  });
  await bounded(new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)));
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await bounded(new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected port');
  return address.port;
}

test('full requests to native BendRT reuse the same PID', async t => {
  const worker = await start(t);
  const pid = worker.pid;
  for (const payload of [Buffer.alloc(0), Buffer.from([0, 128, 255]), Buffer.alloc(248, 255), Buffer.from('Hello BendRT')]) {
    assert.deepEqual(await worker.echo(payload), payload);
    assert.equal(worker.pid, pid);
  }
  await assert.rejects(worker.echo(Buffer.alloc(249)), /body limit/);
  assert.deepEqual(await worker.echo(Buffer.from([1])), Buffer.from([1]));
});

test('missing executable fails clearly and promptly', async () => {
  await rejectsStartup({ executable: resolve('build/missing'), startupMs: 500 }, /launch failed/);
});

test('immediate child exit rejects startup', async () => {
  await rejectsStartup({ executable: resolve('tests/fixtures/exit-worker.mjs'), startupMs: 500 }, /exited.*23/);
});

test('occupied worker port rejects startup and drains native diagnostics', async t => {
  const port = await fixtureServer(t, () => {});
  await rejectsStartup({ executable, port, startupMs: 500 }, /exited|disconnected/);
});

test('startup deadline bounds a child that never listens and drains large diagnostic pipes', async () => {
  await rejectsStartup({ executable: idle, startupMs: 200 }, /startup deadline/);
});

test('connection without handshake cannot establish readiness', async t => {
  const port = await fixtureServer(t, () => {});
  await rejectsStartup({ executable: idle, port, startupMs: 200 }, /startup deadline/);
});

test('Node rejects incompatible contract acknowledgement', async t => {
  const port = await fixtureServer(t, socket => socket.on('data', () => {
    socket.write(encodeFrame({ kind: 2, requestId: 0, operationId: 0, payload: Buffer.from('wrong') }));
  }));
  await rejectsStartup({ executable: idle, port, startupMs: 500 }, /Incompatible worker contract/);
});

test('child termination rejects a pending exchange and future calls', async t => {
  const worker = await start(t);
  process.kill(worker.pid, 'SIGSTOP');
  const call = worker.echo(Buffer.from([1]));
  process.kill(worker.pid, 'SIGKILL');
  await assert.rejects(bounded(call), /disconnected|connection closed|exited|socket failed/);
  await assert.rejects(worker.echo(Buffer.from([2])), { code: 'UNAVAILABLE' });
});

test('suspended worker hits the hard deadline, busy admission fails, and SIGKILL reaps it', async t => {
  const worker = await start(t, 100);
  process.kill(worker.pid, 'SIGSTOP');
  const call = worker.echo(Buffer.from([1]));
  await assert.rejects(worker.echo(Buffer.from([2])), { code: 'BUSY' });
  await assert.rejects(bounded(call), { code: 'DEADLINE' });
  await bounded(worker.close());
  assertGone(worker.pid);
  await assert.rejects(worker.echo(Buffer.from([3])), { code: 'UNAVAILABLE' });
});

test('shutdown is idempotent and cleans up an idle worker', async t => {
  const worker = await start(t);
  const first = worker.close();
  assert.equal(first, worker.close());
  await bounded(first);
  assertGone(worker.pid);
});

test('shutdown rejects an active call and forcibly cleans up a suspended worker', async t => {
  const worker = await start(t);
  process.kill(worker.pid, 'SIGSTOP');
  const call = worker.echo(Buffer.alloc(0));
  const rejection = assert.rejects(call, { code: 'CLOSED' });
  await bounded(worker.close());
  await rejection;
  assertGone(worker.pid);
});

for (const mode of ['version', 'kind', 'request ID', 'operation ID', 'truncated', 'oversized', 'unsolicited']) {
  test(`Node fails the call on ${mode} worker response and terminates the child`, async t => {
    const port = await fixtureServer(t, socket => {
      const decoder = new FrameDecoder();
      socket.on('data', chunk => decoder.push(chunk, frame => {
        if (frame.kind === 1) {
          socket.write(encodeFrame({ kind: 2, requestId: 0, operationId: 0, payload: CONTRACT }));
          return;
        }
        const bytes = encodeFrame({ ...frame, kind: 4 });
        if (mode === 'version') bytes[4] = 255;
        if (mode === 'kind') bytes[5] = 0;
        if (mode === 'request ID') bytes.writeUInt32BE(100, 6);
        if (mode === 'operation ID') bytes.writeUInt16BE(1, 10);
        if (mode === 'oversized') bytes.writeUInt32BE(257, 0);
        if (mode === 'truncated') socket.end(bytes.subarray(0, 6));
        else socket.write(mode === 'unsolicited' ? Buffer.concat([bytes, bytes]) : bytes);
      }));
    });
    const worker = await BendWorker.start({ executable: idle, port, startupMs: 1000, callMs: 500 });
    t.after(async () => { await bounded(worker.close()); assertGone(worker.pid); });
    await assert.rejects(bounded(worker.echo(Buffer.from([1]))), { code: 'PROTOCOL' });
    await bounded(worker.close());
    assertGone(worker.pid);
  });
}
