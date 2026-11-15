import assert from 'node:assert/strict';
import test from 'node:test';
import { NativeSession } from '../../src/session.ts';
import { BendWorker } from '../../src/worker.ts';
import { SESSION_CONTRACT, STEP_OPERATION } from '../../src/protocol/session.ts';
import { CPU_ARGS } from '../../src/runtime.ts';
import { projectPath } from '../../src/paths.ts';
import { assertGone, ownNative } from '../support/resources.ts';
import { bounded } from '../support/deadlines.ts';
import { session } from '../support/native.ts';
import { external as execute } from '../support/subprocess.ts';
import { encodeFrame } from '../../src/protocol/framing.ts';
import { sessionStub } from '../support/session-stub.ts';

const executable = projectPath('build/session-worker');

test('pure native step handles numeric boundaries and count overflow', async () => {
  const result = await execute(projectPath('build/session-cases'), CPU_ARGS, { timeout: 5000 });
  assert.equal(result.stderr, '');
  assert.deepEqual(result.stdout.trim().split('\n'), [
    'value:7:1', 'value:0:1', 'value:0:0', 'value:4294967295:2', 'value:4294967295:2',
    'overflow:4294967295:1', 'overflow:4294967295:1', 'overflow:7:4294967295',
    'value:7:4294967295', 'value:0:0',
  ]);
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
  const worker = ownNative(t, await BendWorker.start({ executable, contract: SESSION_CONTRACT }));
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
  const current = ownNative(t, await NativeSession.start(stub.worker));
  await assert.rejects(bounded(current.command({ kind: 'add', amount: 7 })), { code: 'PROTOCOL' });
  assertGone(current.pid);
  await assert.rejects(current.command({ kind: 'read' }), { code: 'UNAVAILABLE' });
  assert.equal(stub.commands.length, 1);
});

test('session worker rejects the echo contract before accepting commands', async () => {
  await assert.rejects(bounded(BendWorker.start({ executable, startupMs: 500 })), /disconnected|connection closed|exited/);
});
