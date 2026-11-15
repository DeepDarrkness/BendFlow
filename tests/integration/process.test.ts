import assert from 'node:assert/strict';
import test from 'node:test';
import { app } from '../support/native.ts';
import { processCodec } from '../../src/protocol/apps.ts';
import { readFile } from 'node:fs/promises';
import { processFixture } from '../fixtures/process-fixture.ts';
import { worker } from '../support/native.ts';
import { projectPath } from '../../src/paths.ts';
import { PROCESS_CONTRACT } from '../../src/protocol/codecs/process.ts';
import { constants } from 'node:os';

test('process session reads fixture environment and arguments', async t => {
  const session = await app(t, processCodec, 'process', { env: { BENDFLOW_PROBE: 'ok' }, callMs: 4000 });
  assert.deepEqual(await session.command({ kind: 'env', name: 'BENDFLOW_PROBE' }), { kind: 'text', text: 'ok' });
  const args = await session.command({ kind: 'args' });
  assert.equal(args.kind, 'text');
  if (args.kind !== 'text') throw new Error('expected text');
  const fields = args.text.split('\n');
  assert.equal(fields.length, 2);
  assert.equal(fields[0], projectPath('build/process-worker'));
  assert.match(fields[1] ?? '', /^\d+$/);
  assert.doesNotMatch(args.text, /RTS|--threads|--gpu/);
});

test('process.run reports fixture exit status, stdout, and stderr', async t => {
  const session = await app(t, processCodec, 'process', { callMs: 4000 });
  const echoed = await session.command({ kind: 'run', program: '/bin/echo', arg: 'ok', input: '' });
  assert.equal(echoed.kind, 'run');
  if (echoed.kind !== 'run') throw new Error('expected run');
  assert.equal(echoed.code, 0);
  assert.match(echoed.stdout, /ok/);
  const failed = await session.command({ kind: 'run', program: '/bin/ls', arg: '/no-such-bendflow', input: '' });
  assert.equal(failed.kind, 'run');
  if (failed.kind !== 'run') throw new Error('expected run');
  assert.notEqual(failed.code, 0);
  assert.match(failed.stderr, /No such file|cannot access/i);
});

test('process random returns a u32', async t => {
  const session = await app(t, processCodec, 'process', { callMs: 4000 });
  const got = await session.command({ kind: 'random' });
  assert.equal(got.kind, 'random');
  if (got.kind !== 'random') throw new Error('expected random');
  assert.ok(Number.isInteger(got.value) && got.value >= 0 && got.value <= 0xffffffff);
});

test('fixed process fixture reports exact literal args stdin stdout stderr and status', async t => {
  const fixture = await processFixture(t);
  const session = await app(t, processCodec, 'process', { env: fixture.env, callMs: 4000 });
  const arg = 'literal;$(false)';
  const input = 'input 😀';
  const expected = `mode=report;arg=${arg};stdin=${input}\n`;
  assert.deepEqual(await session.command({ kind: 'fixture', behavior: 'report', arg, input }), {
    kind: 'run', code: 7, stdout: expected, stderr: 'fixture stderr\n',
  });
  assert.equal(await readFile(fixture.marker, 'utf8'), expected);
});

test('process launch timeout combined output and missing environment failures recover', async t => {
  const fixture = await processFixture(t);
  const session = await app(t, processCodec, 'process', { env: { ...fixture.env, BENDFLOW_PRESENT: 'yes' }, callMs: 4000 });
  for (const command of [
    { kind: 'run', program: '/no-such-bendflow-program', arg: '', input: '' },
    { kind: 'env', name: 'BENDFLOW_ABSENT_763EA' },
    { kind: 'fixture', behavior: 'timeout', arg: 'timed', input: 'entered' },
    { kind: 'fixture', behavior: 'overflow', arg: 'bounded', input: '' },
  ] satisfies Parameters<typeof session.command>[0][]) {
    const failed = await session.command(command);
    assert.equal(failed.kind, 'fail');
    if (failed.kind !== 'fail') throw new Error('expected effect failure');
    assert.equal(failed.code, command.kind === 'fixture'
      ? command.behavior === 'timeout' ? constants.errno.ETIMEDOUT : constants.errno.EFBIG
      : constants.errno.ENOENT);
    assert.ok(Buffer.byteLength(failed.message) <= 96);
    assert.deepEqual(await session.command({ kind: 'fixture', behavior: 'success', arg: 'recovery', input: '' }), {
      kind: 'run', code: 0, stdout: 'ok\n', stderr: '',
    });
  }
  assert.equal(await readFile(fixture.marker, 'utf8'), [
    'mode=success;arg=recovery;stdin=', 'mode=success;arg=recovery;stdin=',
    'mode=timeout;arg=timed;stdin=entered', 'mode=success;arg=recovery;stdin=',
    'mode=overflow;arg=bounded;stdin=', 'mode=success;arg=recovery;stdin=', '',
  ].join('\n'));
  assert.deepEqual(await session.command({ kind: 'env', name: 'BENDFLOW_PRESENT' }), { kind: 'text', text: 'yes' });
});

test('raw process malformed and semantic inputs are rejected before launch', async t => {
  const fixture = await processFixture(t);
  const native = await worker(t, { executable: projectPath('build/process-worker'), contract: PROCESS_CONTRACT, env: fixture.env, callMs: 4000 });
  for (const payload of [
    Buffer.from([99]), Buffer.from([1, 0]), Buffer.from([0, 0]), Buffer.from([0, 1, 0]),
    Buffer.from([0, 1, 61]), Buffer.from([2, 0, 0, 0]), Buffer.from([2, 1, 120, 1, 0, 0]),
    Buffer.from([4, 4, 0, 0]), Buffer.from([4, 0, 1, 0, 0]), Buffer.from([4, 0, 2, 0xc0, 0xaf, 0]),
    Buffer.from([4, 0, 33, ...Buffer.alloc(33, 120), 0]),
  ]) assert.deepEqual(await native.call(1, payload), Buffer.from([255]));
  for (const command of [
    { kind: 'env', name: 'BENDFLOW_PROCESS_FIXTURE' }, { kind: 'args' },
    { kind: 'run', program: fixture.executable, arg: 'success', input: '' }, { kind: 'random' },
    { kind: 'fixture', behavior: 'report', arg: 'never', input: '' },
    { kind: 'fixture', behavior: 'success', arg: 'never', input: '' },
    { kind: 'fixture', behavior: 'timeout', arg: 'never', input: '' },
    { kind: 'fixture', behavior: 'overflow', arg: 'never', input: '' },
  ] satisfies Parameters<typeof processCodec.encode>[0][]) {
    const payload = processCodec.encode(command);
    for (let length = 0; length < payload.length; length++) assert.deepEqual(await native.call(1, payload.subarray(0, length)), Buffer.from([255]));
    assert.deepEqual(await native.call(1, Buffer.concat([payload, Buffer.from([0])])), Buffer.from([255]));
  }
  await assert.rejects(readFile(fixture.marker), { code: 'ENOENT' });
  const payload = processCodec.encode({ kind: 'fixture', behavior: 'success', arg: '', input: '' });
  assert.deepEqual(processCodec.decode(await native.call(1, payload)), { kind: 'run', code: 0, stdout: 'ok\n', stderr: '' });
  assert.equal(await readFile(fixture.marker, 'utf8'), 'mode=success;arg=;stdin=\n');
});

test('oversized native environment output returns a bounded error and preserves the session', async t => {
  const session = await app(t, processCodec, 'process', { env: { BENDFLOW_LARGE: '😀'.repeat(30), BENDFLOW_SMALL: 'ok' }, callMs: 4000 });
  assert.deepEqual(await session.command({ kind: 'env', name: 'BENDFLOW_LARGE' }), {
    kind: 'fail', code: 75, message: 'reply exceeds text bound',
  });
  assert.deepEqual(await session.command({ kind: 'env', name: 'BENDFLOW_SMALL' }), { kind: 'text', text: 'ok' });
});
