import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import test, { type TestContext } from 'node:test';
import { commandSchema } from '../contracts/session.ts';
import { NativeSession } from '../src/session.ts';
import { BendWorker } from '../src/worker.ts';
import { decodeReply, encodeCommand, SESSION_CONTRACT, STEP_OPERATION } from '../src/protocol/session.ts';
import { CPU_ARGS } from '../src/runtime.ts';
import { assertGone, bounded } from './helpers.ts';
import { bun, environment, source } from '../scripts/toolchain.ts';
import { encodeFrame } from '../src/protocol/framing.ts';
import { sessionStub } from './session-stub.ts';

const execute = promisify(execFile);
const executable = resolve('build/session-worker');

async function session(t: TestContext, callMs = 500): Promise<NativeSession> {
  const session = await NativeSession.start({ executable, callMs });
  t.after(async () => { await bounded(session.close()); assertGone(session.pid); });
  return session;
}

test('Bend checker rejects duplicating the affine session state', async () => {
  await assert.rejects(execute(bun, [resolve(source, 'bend2/main.ts'), 'tests/fixtures/duplicate-session-state.bend', '--check-only'], {
    env: environment, timeout: 10_000,
  }), error => {
    assert.ok(error instanceof Error && 'stderr' in error && 'code' in error);
    assert.equal(error.code, 1);
    assert.match(String(error.stderr), /state \(consumed more than once\)/);
    return true;
  });
});

test('pure native step handles numeric boundaries and count overflow', async () => {
  const result = await execute(resolve('build/session-cases'), CPU_ARGS, { timeout: 5000 });
  assert.equal(result.stderr, '');
  assert.deepEqual(result.stdout.trim().split('\n'), [
    'value:7:1', 'value:0:1', 'value:0:0', 'value:4294967295:2', 'value:4294967295:2',
    'overflow:4294967295:1', 'overflow:4294967295:1', 'overflow:7:4294967295',
    'value:7:4294967295', 'value:0:0',
  ]);
});

test('session codec agrees with hand-specified command and result bytes', () => {
  assert.equal(encodeCommand({ kind: 'add', amount: 7 }).toString('hex'), '0000000007');
  assert.equal(encodeCommand({ kind: 'add', amount: 0xffffffff }).toString('hex'), '00ffffffff');
  assert.equal(encodeCommand({ kind: 'read' }).toString('hex'), '01');
  assert.equal(encodeCommand({ kind: 'reset' }).toString('hex'), '02');
  assert.deepEqual(decodeReply(Buffer.from('000000000700000001', 'hex')), { kind: 'value', value: { total: 7, acceptedAdds: 1 } });
  assert.deepEqual(decodeReply(Buffer.from('01ffffffff00000002', 'hex')), { kind: 'overflow', value: { total: 0xffffffff, acceptedAdds: 2 } });
  assert.deepEqual(decodeReply(Buffer.from('02', 'hex')), { kind: 'invalidCommand' });
  for (const hex of ['', '00', '03', '0200', '00000000070000000100', '030000000700000001']) {
    assert.throws(() => decodeReply(Buffer.from(hex, 'hex')), /Malformed session result/);
  }
});

test('public command schema rejects unsupported shapes and U32 values', () => {
  for (const input of [null, {}, { kind: 'add' }, { kind: 'read', amount: 7 }, { kind: 'reset', extra: 1 },
    { kind: 'eval', source: 'arbitrary function' }, ...[-1, 1.5, 0x100000000, NaN, Infinity].map(amount => ({ kind: 'add', amount }))]) {
    assert.equal(commandSchema.safeParse(input).success, false);
  }
});

test('identical commands advance native state while read/reset preserve their semantics', async t => {
  const current = await session(t);
  const pid = current.pid;
  for (let count = 1; count <= 3; count++) {
    assert.deepEqual(await current.command({ kind: 'add', amount: 7 }), { kind: 'value', value: { total: count * 7, acceptedAdds: count } });
    assert.equal(current.pid, pid);
  }
  assert.deepEqual(await current.command({ kind: 'read' }), { kind: 'value', value: { total: 21, acceptedAdds: 3 } });
  assert.deepEqual(await current.command({ kind: 'read' }), { kind: 'value', value: { total: 21, acceptedAdds: 3 } });
  assert.deepEqual(await current.command({ kind: 'reset' }), { kind: 'value', value: { total: 0, acceptedAdds: 0 } });
  assert.deepEqual(await current.command({ kind: 'add', amount: 5 }), { kind: 'value', value: { total: 5, acceptedAdds: 1 } });
});

test('overflow preserves the native state and later commands still succeed', async t => {
  const current = await session(t);
  assert.deepEqual(await current.command({ kind: 'add', amount: 0xffffffff }), { kind: 'value', value: { total: 0xffffffff, acceptedAdds: 1 } });
  assert.deepEqual(await current.command({ kind: 'add', amount: 1 }), { kind: 'overflow', value: { total: 0xffffffff, acceptedAdds: 1 } });
  assert.deepEqual(await current.command({ kind: 'read' }), { kind: 'value', value: { total: 0xffffffff, acceptedAdds: 1 } });
  assert.deepEqual(await current.command({ kind: 'add', amount: 0 }), { kind: 'value', value: { total: 0xffffffff, acceptedAdds: 2 } });
});

test('malformed native command payloads leave the session state unchanged', async t => {
  const worker = await BendWorker.start({ executable, contract: SESSION_CONTRACT });
  t.after(async () => { await bounded(worker.close()); assertGone(worker.pid); });
  assert.deepEqual(await worker.call(STEP_OPERATION, Buffer.from('0000000007', 'hex')), Buffer.from('000000000700000001', 'hex'));
  for (const payload of [Buffer.alloc(0), Buffer.from([255]), Buffer.from([0]), Buffer.from([0, 0, 0, 0]),
    Buffer.from([0, 0, 0, 0, 7, 0]), Buffer.from([1, 0]), Buffer.from([2, 0])]) {
    assert.deepEqual(await worker.call(STEP_OPERATION, payload), Buffer.from([2]));
    assert.deepEqual(await worker.call(STEP_OPERATION, Buffer.from([1])), Buffer.from('000000000700000001', 'hex'));
  }
  assert.deepEqual(await worker.call(STEP_OPERATION, Buffer.from('0000000007', 'hex')), Buffer.from('000000000e00000002', 'hex'));
});

test('independent native workers have independent session states', async t => {
  const first = await session(t);
  const second = await session(t);
  assert.notEqual(first.pid, second.pid);
  await first.command({ kind: 'add', amount: 7 });
  await first.command({ kind: 'add', amount: 7 });
  assert.deepEqual(await second.command({ kind: 'read' }), { kind: 'value', value: { total: 0, acceptedAdds: 0 } });
  assert.deepEqual(await second.command({ kind: 'add', amount: 2 }), { kind: 'value', value: { total: 2, acceptedAdds: 1 } });
  assert.deepEqual(await first.command({ kind: 'read' }), { kind: 'value', value: { total: 14, acceptedAdds: 2 } });
});

test('suspended sessions reject competing commands and expire without replay', async t => {
  const current = await session(t, 100);
  await current.command({ kind: 'add', amount: 7 });
  process.kill(current.pid, 'SIGSTOP');
  const pending = current.command({ kind: 'add', amount: 7 });
  await assert.rejects(current.command({ kind: 'add', amount: 7 }), { code: 'BUSY' });
  await assert.rejects(bounded(pending), { code: 'DEADLINE' });
  await bounded(current.close());
  assertGone(current.pid);
  await assert.rejects(current.command({ kind: 'read' }), { code: 'UNAVAILABLE' });
  const fresh = await session(t);
  assert.deepEqual(await fresh.command({ kind: 'read' }), { kind: 'value', value: { total: 0, acceptedAdds: 0 } });
});

test('fixed-seed command stream agrees with a cumulative mathematical oracle', async t => {
  const current = await session(t);
  let seed = 123456;
  let total = 0;
  let acceptedAdds = 0;
  for (let i = 0; i < 100; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const amount = seed;
    const fits = total + amount <= 0xffffffff;
    if (fits) { total += amount; acceptedAdds++; }
    assert.deepEqual(await current.command({ kind: 'add', amount }), {
      kind: fits ? 'value' : 'overflow', value: { total, acceptedAdds },
    });
    if (i % 20 === 19) {
      await current.command({ kind: 'reset' });
      total = 0;
      acceptedAdds = 0;
    }
  }
});

test('malformed framed session response terminates the worker and prevents another dispatch', async t => {
  const stub = await sessionStub(t, (frame, socket) => socket.write(encodeFrame({ ...frame, kind: 4, payload: Buffer.from([0]) })));
  const current = await NativeSession.start(stub.worker);
  t.after(async () => { await bounded(current.close()); assertGone(current.pid); });
  await assert.rejects(bounded(current.command({ kind: 'add', amount: 7 })), { code: 'PROTOCOL' });
  assertGone(current.pid);
  await assert.rejects(current.command({ kind: 'read' }), { code: 'UNAVAILABLE' });
  assert.equal(stub.commands.length, 1);
});

test('session worker rejects the echo contract before accepting commands', async () => {
  await assert.rejects(bounded(BendWorker.start({ executable, startupMs: 500 })), /disconnected|connection closed|exited/);
});
