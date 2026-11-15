import assert from 'node:assert/strict';
import test from 'node:test';
import { app } from '../support/native.ts';
import { pollDiagnostic } from '../support/deadlines.ts';
import { taskCodec } from '../../src/protocol/apps.ts';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { scratch, assertGone } from '../support/resources.ts';
import { bounded } from '../support/deadlines.ts';
import { worker } from '../support/native.ts';
import { projectPath } from '../../src/paths.ts';
import { TASK_CONTRACT } from '../../src/protocol/codecs/task.ts';
import { external } from '../support/subprocess.ts';
import { bun, source, environment } from '../../scripts/lib/toolchain.ts';
import { CPU_ARGS } from '../../src/runtime.ts';

test('compiled timeout bookkeeping retains no successful or completed late acknowledgements', async t => {
  const executable = join(await scratch(t, 'bf-task-ack-'), 'bookkeeping');
  await external(bun, [join(source, 'bend2/main.ts'), projectPath('tests/fixtures/phase2/task-ack-bookkeeping.bend'), '-o', executable], {
    env: environment, timeout: 120_000,
  });
  const result = await external(executable, CPU_ARGS, { env: environment });
  assert.match(result.stdout, /^successful pending: 0$/m);
  assert.match(result.stdout, /^late pending: 0$/m);
  assert.equal(result.stdout.match(/^early$/gm)?.length, 64);
  assert.equal(result.stdout.match(/^late$/gm)?.length, 64);
});

test('timeout admission is bounded and recovers after late acknowledgements', async t => {
  const session = await app(t, taskCodec, 'task', { callMs: 8000, terminationGraceMs: 4000 });
  for (let wave = 0; wave < 2; wave++) {
    for (let job = 0; job < 16; job++) {
      assert.deepEqual(await session.command({ kind: 'timeout', limit: 0, ms: 2000, text: `pending-${wave}-${job}` }), { kind: 'timeout' });
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      assert.deepEqual(await session.command({ kind: 'timeout', limit: 0, ms: 0, text: 'rejected-effect' }), {
        kind: 'fail', code: 75, message: 'timeout jobs full',
      });
    }
    assert.deepEqual(await session.command({ kind: 'nap', ms: 0 }), { kind: 'ok' });
    await pollDiagnostic(() => session.diagnostics, new RegExp(`pending-${wave}-15`), 8000);
    assert.deepEqual(await session.command({ kind: 'timeout', limit: 1000, ms: 0, text: `recovered-${wave}` }), {
      kind: 'text', text: `recovered-${wave}`,
    });
  }
  await bounded(session.close(), 8000);
  assertGone(session.pid);
  assert.doesNotMatch(session.diagnostics, /rejected-effect/);
  for (let wave = 0; wave < 2; wave++) {
    for (let job = 0; job < 16; job++) assert.match(session.diagnostics, new RegExp(`pending-${wave}-${job}\\b`));
  }
});

test('forked nap prints then join collects the result', async t => {
  const session = await app(t, taskCodec, 'task', { callMs: 4000 });
  const started = await session.command({ kind: 'start', ms: 20, text: 'job' });
  assert.equal(started.kind, 'started');
  if (started.kind !== 'started') throw new Error('expected started');
  assert.deepEqual(await session.command({ kind: 'join', id: started.id }), { kind: 'text', text: 'job' });
});

test('IO.within timeout still lets the late effect print', async t => {
  const session = await app(t, taskCodec, 'task', { callMs: 8000 });
  assert.deepEqual(await session.command({ kind: 'timeout', limit: 10, ms: 150, text: 'late' }), { kind: 'timeout' });
  await pollDiagnostic(() => session.diagnostics, /late/);
  assert.match(session.diagnostics, /late/);
  assert.deepEqual(await session.command({ kind: 'nap', ms: 0 }), { kind: 'ok' });
});

test('direct nap and within success preserve usable task state', async t => {
  const session = await app(t, taskCodec, 'task', { callMs: 4000 });
  assert.deepEqual(await session.command({ kind: 'nap', ms: 0 }), { kind: 'ok' });
  const before = performance.now();
  assert.deepEqual(await session.command({ kind: 'nap', ms: 25 }), { kind: 'ok' });
  assert.ok(performance.now() - before >= 20, 'nap must wait for its requested timer');
  assert.deepEqual(await session.command({ kind: 'timeout', limit: 1000, ms: 0, text: 'early' }), { kind: 'text', text: 'early' });
  await pollDiagnostic(() => session.diagnostics, /early/);
});

test('spawn channel rendezvous echoes exact messages and rejects sends after close', async t => {
  const session = await app(t, taskCodec, 'task', { callMs: 4000 });
  for (const text of ['', '😀 handshake', 'x'.repeat(64)]) {
    assert.deepEqual(await session.command({ kind: 'channels', text }), { kind: 'text', text });
  }
});

test('affine file transfers into a gated job and returns only on exactly-once collect', async t => {
  const dir = await scratch(t, 'bf-task-');
  const path = join(dir, 'owned');
  const session = await app(t, taskCodec, 'task', { callMs: 4000 });
  assert.deepEqual(await session.command({ kind: 'openFile', path }), { kind: 'ok' });
  assert.deepEqual(await session.command({ kind: 'writeFile', text: 'front:' }), { kind: 'ok' });
  assert.deepEqual(await session.command({ kind: 'transfer', text: 'background:' }), { kind: 'ok' });
  assert.equal(await readFile(path, 'utf8'), 'front:');
  for (const command of [{ kind: 'writeFile', text: 'forbidden' }, { kind: 'collect' }, { kind: 'closeFile' }] satisfies Parameters<typeof session.command>[0][]) {
    assert.deepEqual(await session.command(command), { kind: 'missing' });
  }
  assert.equal(await readFile(path, 'utf8'), 'front:');
  assert.deepEqual(await session.command({ kind: 'release' }), { kind: 'ok' });
  assert.equal(await readFile(path, 'utf8'), 'front:background:');
  assert.deepEqual(await session.command({ kind: 'writeFile', text: 'still forbidden' }), { kind: 'missing' });
  assert.deepEqual(await session.command({ kind: 'collect' }), { kind: 'ok' });
  assert.deepEqual(await session.command({ kind: 'collect' }), { kind: 'missing' });
  assert.deepEqual(await session.command({ kind: 'release' }), { kind: 'missing' });
  assert.deepEqual(await session.command({ kind: 'writeFile', text: 'returned' }), { kind: 'ok' });
  assert.deepEqual(await session.command({ kind: 'closeFile' }), { kind: 'ok' });
  assert.equal(await readFile(path, 'utf8'), 'front:background:returned');
});

test('multiple text jobs complete before join and are collected exactly once', async t => {
  const session = await app(t, taskCodec, 'task', { callMs: 4000 });
  const ids: number[] = [];
  for (const text of ['first-done', 'second-done', 'third-done']) {
    const started = await session.command({ kind: 'start', ms: 0, text });
    if (started.kind !== 'started') throw new Error('expected started');
    ids.push(started.id);
    await pollDiagnostic(() => session.diagnostics, new RegExp(text));
  }
  assert.equal(new Set(ids).size, 3);
  assert.deepEqual(await session.command({ kind: 'join', id: 999 }), { kind: 'missing' });
  for (const [index, text] of [...['first-done', 'second-done', 'third-done'].entries()].reverse()) {
    const id = ids[index];
    if (id === undefined) throw new Error('missing fixture ID');
    assert.deepEqual(await session.command({ kind: 'join', id }), { kind: 'text', text });
    assert.deepEqual(await session.command({ kind: 'join', id }), { kind: 'missing' });
  }
});

test('graceful task shutdown drains outstanding jobs and releases a gated affine file', async t => {
  const dir = await scratch(t, 'bf-stop-');
  const path = join(dir, 'owned');
  const session = await app(t, taskCodec, 'task', { callMs: 4000, terminationGraceMs: 2000 });
  await session.command({ kind: 'openFile', path });
  await session.command({ kind: 'transfer', text: 'must not run' });
  await session.command({ kind: 'start', ms: 100, text: 'shutdown-drained' });
  await bounded(session.close(), 4000);
  assertGone(session.pid);
  assert.match(session.diagnostics, /shutdown-drained/);
  assert.match(session.diagnostics, /task-file-closed/);
  assert.equal(await readFile(path, 'utf8'), '');
});

test('task shutdown has a bounded forced fallback for long outstanding work', async t => {
  const session = await app(t, taskCodec, 'task', { callMs: 4000, terminationGraceMs: 50 });
  await session.command({ kind: 'start', ms: 10000, text: 'too-late' });
  await bounded(session.close(), 2000);
  assertGone(session.pid);
  assert.doesNotMatch(session.diagnostics, /too-late/);
});

test('graceful shutdown observes completed transfer cleanup and drains a losing within effect', async t => {
  const path = join(await scratch(t, 'bf-done-'), 'owned');
  const session = await app(t, taskCodec, 'task', { callMs: 4000, terminationGraceMs: 2000 });
  await session.command({ kind: 'openFile', path });
  await session.command({ kind: 'transfer', text: 'completed' });
  await session.command({ kind: 'release' });
  assert.equal(await readFile(path, 'utf8'), 'completed');
  assert.deepEqual(await session.command({ kind: 'timeout', limit: 0, ms: 100, text: 'shutdown-late-effect' }), { kind: 'timeout' });
  await bounded(session.close(), 4000);
  assertGone(session.pid);
  assert.match(session.diagnostics, /task-file-closed/);
  assert.match(session.diagnostics, /shutdown-late-effect/);
  assert.equal(await readFile(path, 'utf8'), 'completed');
});

test('raw task semantic and wire failures perform no effects and retain ownership', async t => {
  const native = await worker(t, { executable: projectPath('build/task-worker'), contract: TASK_CONTRACT, callMs: 4000 });
  const dir = await scratch(t, 'bf-raw-');
  const path = join(dir, 'owned');
  for (const payload of [Buffer.from([99]), Buffer.from([8, 0]), Buffer.from([5, 0]), Buffer.from([5, 1, 0]), Buffer.from([2, 0, 0, 0, 0]), Buffer.from([0, 0, 0, 39, 17]), Buffer.from([4, 2, 0xc0, 0xaf])]) {
    assert.deepEqual(await native.call(1, payload), Buffer.from([255]));
  }
  for (const command of [
    { kind: 'nap', ms: 0 }, { kind: 'start', ms: 0, text: 'must-not-print' }, { kind: 'join', id: 1 },
    { kind: 'timeout', limit: 0, ms: 0, text: 'must-not-print' }, { kind: 'channels', text: 'x' },
    { kind: 'openFile', path }, { kind: 'writeFile', text: 'x' }, { kind: 'transfer', text: 'x' },
    { kind: 'release' }, { kind: 'collect' }, { kind: 'closeFile' },
  ] satisfies Parameters<typeof taskCodec.encode>[0][]) {
    const payload = taskCodec.encode(command);
    for (let length = 0; length < payload.length; length++) assert.deepEqual(await native.call(1, payload.subarray(0, length)), Buffer.from([255]));
    assert.deepEqual(await native.call(1, Buffer.concat([payload, Buffer.from([0])])), Buffer.from([255]));
  }
  await assert.rejects(readFile(path), { code: 'ENOENT' });
  assert.doesNotMatch(native.diagnostics, /must-not-print/);
  assert.deepEqual(taskCodec.decode(await native.call(1, taskCodec.encode({ kind: 'openFile', path }))), { kind: 'ok' });
  assert.deepEqual(await native.call(1, Buffer.from([7, 65, ...Buffer.alloc(65, 120)])), Buffer.from([255]));
  assert.deepEqual(taskCodec.decode(await native.call(1, taskCodec.encode({ kind: 'writeFile', text: 'safe' }))), { kind: 'ok' });
  assert.equal(await readFile(path, 'utf8'), 'safe');
  const maximum = '😀'.repeat(16);
  assert.deepEqual(taskCodec.decode(await native.call(1, taskCodec.encode({ kind: 'channels', text: maximum }))), { kind: 'text', text: maximum });
  assert.deepEqual(taskCodec.decode(await native.call(1, taskCodec.encode({ kind: 'writeFile', text: maximum }))), { kind: 'ok' });
  assert.equal(await readFile(path, 'utf8'), 'safe' + maximum);
});

test('compiler accepts resource transfer and rejects foreground reuse after fork', async () => {
  const positive = await external(bun, [join(source, 'bend2/main.ts'), projectPath('tests/fixtures/phase2/task-resource-positive.bend'), '--check-only']);
  assert.match(positive.stdout, /ALL PROOFS CHECK/);
  await assert.rejects(external(bun, [join(source, 'bend2/main.ts'), projectPath('tests/fixtures/phase2/task-resource-negative.bend'), '--check-only']), error => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /consumed|more than once|quantity|affine/i);
    assert.doesNotMatch(error.message, /expected : 'def'|not defined|missing import/);
    return true;
  });
});
