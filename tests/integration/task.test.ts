import assert from 'node:assert/strict';
import test from 'node:test';
import { app } from '../support/native.ts';
import { pollDiagnostic } from '../support/deadlines.ts';
import { taskCodec } from '../../src/protocol/apps.ts';

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
});
