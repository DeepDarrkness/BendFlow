import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { createAppClient } from '../../src/client.ts';
import { gateway } from '../support/gateways.ts';
import { scratch, assertGone } from '../support/resources.ts';
import { processFixture } from '../fixtures/process-fixture.ts';
import { constants } from 'node:os';

test('HTTP task channels timers and affine transfer have observed success failure recovery and isolation', async t => {
  const server = await gateway(t, { worker: { callMs: 4000, terminationGraceMs: 2000 } });
  const first = createAppClient(server.url);
  const observer = createAppClient(server.url);
  const { sessionId } = await first.sessions.create({ kind: 'task' });
  const other = await observer.sessions.create({ kind: 'task' });
  assert.deepEqual(await first.task.command({ sessionId, command: { kind: 'channels', text: 'HTTP 😀' } }), { kind: 'text', text: 'HTTP 😀' });
  assert.deepEqual(await observer.task.command({ sessionId, command: { kind: 'nap', ms: 0 } }), { kind: 'ok' });
  assert.deepEqual(await first.task.command({ sessionId, command: { kind: 'timeout', limit: 0, ms: 100, text: 'HTTP late' } }), { kind: 'timeout' });
  assert.deepEqual(await observer.task.command({ sessionId, command: { kind: 'timeout', limit: 1000, ms: 0, text: 'HTTP early' } }), { kind: 'text', text: 'HTTP early' });
  const path = join(await scratch(t, 'bf-http-task-'), 'owned');
  const failed = await first.task.command({ sessionId, command: { kind: 'openFile', path: join(path, 'absent') } });
  assert.equal(failed.kind, 'fail');
  assert.deepEqual(await first.task.command({ sessionId, command: { kind: 'openFile', path } }), { kind: 'ok' });
  assert.deepEqual(await first.task.command({ sessionId, command: { kind: 'transfer', text: 'remote job' } }), { kind: 'ok' });
  assert.equal(await readFile(path, 'utf8'), '');
  assert.deepEqual(await observer.task.command({ sessionId, command: { kind: 'writeFile', text: 'forbidden' } }), { kind: 'missing' });
  assert.deepEqual(await observer.task.command({ sessionId: other.sessionId, command: { kind: 'release' } }), { kind: 'missing' });
  assert.deepEqual(await observer.task.command({ sessionId, command: { kind: 'release' } }), { kind: 'ok' });
  assert.equal(await readFile(path, 'utf8'), 'remote job');
  assert.deepEqual(await first.task.command({ sessionId, command: { kind: 'collect' } }), { kind: 'ok' });
  assert.deepEqual(await observer.task.command({ sessionId, command: { kind: 'collect' } }), { kind: 'missing' });
  assert.deepEqual(await observer.task.command({ sessionId, command: { kind: 'writeFile', text: ':foreground' } }), { kind: 'ok' });
  assert.deepEqual(await first.task.command({ sessionId, command: { kind: 'closeFile' } }), { kind: 'ok' });
  assert.equal(await readFile(path, 'utf8'), 'remote job:foreground');
  const started = await first.task.command({ sessionId, command: { kind: 'start', ms: 0, text: 'remote text' } });
  if (started.kind !== 'started') throw new Error('expected started');
  assert.deepEqual(await observer.task.command({ sessionId: other.sessionId, command: { kind: 'join', id: started.id } }), { kind: 'missing' });
  assert.deepEqual(await observer.task.command({ sessionId, command: { kind: 'join', id: started.id } }), { kind: 'text', text: 'remote text' });
  assert.deepEqual(await first.task.command({ sessionId, command: { kind: 'join', id: started.id } }), { kind: 'missing' });
  const pids = server.workerPids;
  await first.sessions.close({ sessionId });
  await observer.sessions.close({ sessionId: other.sessionId });
  pids.forEach(assertGone);
});

test('HTTP process fixture independently observes literal input and recovers from every effect failure', async t => {
  const fixture = await processFixture(t);
  const server = await gateway(t, { worker: { callMs: 4000, env: fixture.env } });
  const first = createAppClient(server.url);
  const observer = createAppClient(server.url);
  const { sessionId } = await first.sessions.create({ kind: 'process' });
  assert.deepEqual(await first.process.command({ sessionId, command: { kind: 'fixture', behavior: 'report', arg: 'literal;echo', input: 'HTTP input' } }), {
    kind: 'run', code: 7, stdout: 'mode=report;arg=literal;echo;stdin=HTTP input\n', stderr: 'fixture stderr\n',
  });
  assert.equal(await readFile(fixture.marker, 'utf8'), 'mode=report;arg=literal;echo;stdin=HTTP input\n');
  for (const command of [
    { kind: 'run', program: '/no-bendflow-http-program', arg: '', input: '' },
    { kind: 'env', name: 'BENDFLOW_HTTP_ABSENT_76BA' },
    { kind: 'fixture', behavior: 'timeout', arg: 'timed', input: 'observed' },
    { kind: 'fixture', behavior: 'overflow', arg: 'bounded', input: '' },
  ] satisfies Parameters<typeof first.process.command>[0]['command'][]) {
    const failed = await first.process.command({ sessionId, command });
    assert.equal(failed.kind, 'fail');
    if (failed.kind !== 'fail') throw new Error('expected effect failure');
    assert.equal(failed.code, command.kind === 'fixture'
      ? command.behavior === 'timeout' ? constants.errno.ETIMEDOUT : constants.errno.EFBIG
      : constants.errno.ENOENT);
    assert.deepEqual(await observer.process.command({ sessionId, command: { kind: 'fixture', behavior: 'success', arg: 'recover', input: '' } }), {
      kind: 'run', code: 0, stdout: 'ok\n', stderr: '',
    });
  }
  assert.equal(await readFile(fixture.marker, 'utf8'), [
    'mode=report;arg=literal;echo;stdin=HTTP input',
    'mode=success;arg=recover;stdin=', 'mode=success;arg=recover;stdin=',
    'mode=timeout;arg=timed;stdin=observed', 'mode=success;arg=recover;stdin=',
    'mode=overflow;arg=bounded;stdin=', 'mode=success;arg=recover;stdin=', '',
  ].join('\n'));
  const random = await observer.process.command({ sessionId, command: { kind: 'random' } });
  if (random.kind !== 'random') throw new Error('expected random');
  assert.ok(Number.isInteger(random.value) && random.value >= 0 && random.value <= 0xffffffff);
  const pids = server.workerPids;
  await observer.sessions.close({ sessionId });
  pids.forEach(assertGone);
});

test('HTTP malformed task and process commands fail before effects and preserve recovery', async t => {
  const fixture = await processFixture(t);
  const server = await gateway(t, { worker: { callMs: 4000, env: fixture.env } });
  const remote = createAppClient(server.url);
  const task = await remote.sessions.create({ kind: 'task' });
  const process = await remote.sessions.create({ kind: 'process' });
  for (const [kind, sessionId, command] of [
    ['task', task.sessionId, { kind: 'nap', ms: 10001 }],
    ['task', task.sessionId, { kind: 'transfer', text: 'x'.repeat(65) }],
    ['process', process.sessionId, { kind: 'fixture', behavior: 'timeout', arg: '\0', input: '' }],
    ['process', process.sessionId, { kind: 'run', program: '', arg: '', input: '' }],
  ]) {
    const response = await fetch(`${server.url}/${kind}/command`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ json: { sessionId, command } }),
    });
    assert.equal(response.status, 400);
    await response.text();
  }
  await assert.rejects(readFile(fixture.marker), { code: 'ENOENT' });
  assert.deepEqual(await remote.task.command({ sessionId: task.sessionId, command: { kind: 'channels', text: 'recovered' } }), { kind: 'text', text: 'recovered' });
  assert.deepEqual(await remote.process.command({ sessionId: process.sessionId, command: { kind: 'fixture', behavior: 'success', arg: '', input: '' } }), {
    kind: 'run', code: 0, stdout: 'ok\n', stderr: '',
  });
});
