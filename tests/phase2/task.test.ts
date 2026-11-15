import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test, { type TestContext } from 'node:test';
import { NativeApp } from '../../src/app.ts';
import { taskCodec } from '../../src/protocol/apps.ts';
import { assertGone, bounded } from '../helpers.ts';

const executable = resolve('build/task-worker');

async function app(t: TestContext, callMs = 4000) {
  const session = await NativeApp.start(taskCodec, { executable, callMs });
  t.after(async () => { await bounded(session.close(), 5000); if (session.pid) try { assertGone(session.pid); } catch {} });
  return session;
}

test('forked nap prints then join collects the result', async t => {
  const session = await app(t);
  const started = await session.command({ kind: 'start', ms: 20, text: 'job' });
  assert.equal(started.kind, 'started');
  if (started.kind !== 'started') throw new Error('expected started');
  assert.deepEqual(await session.command({ kind: 'join', id: started.id }), { kind: 'text', text: 'job' });
});

test('IO.within timeout still lets the late effect print', async t => {
  const session = await app(t, 8000);
  assert.deepEqual(await session.command({ kind: 'timeout', limit: 10, ms: 150, text: 'late' }), { kind: 'timeout' });
  await delay(300);
  assert.match(session.diagnostics, /late/);
});
