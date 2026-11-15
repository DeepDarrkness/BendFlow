import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';
import { NativeApp, type AppCodec } from '../../src/app.ts';
import { AppSessions } from '../../src/apps.ts';
import type { WorkerOptions } from '../../src/worker.ts';
import { numericCodec } from '../../src/protocol/apps.ts';
import { assertGone, bounded } from '../helpers.ts';

test('gateway shutdown reports cleanup failure for a session still starting', async t => {
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const realStart = NativeApp.start;
  const realClose = NativeApp.prototype.close;
  let cleanup: (() => Promise<void>) | undefined;
  let pid: number | undefined;
  t.after(async () => { release.resolve(); await cleanup?.(); if (pid !== undefined) assertGone(pid); });
  t.mock.method(NativeApp, 'start', async function<Command, Reply>(codec: AppCodec<Command, Reply>, options: Omit<WorkerOptions, 'contract'>) {
    const app = await realStart(codec, options);
    pid = app.pid;
    cleanup = () => realClose.call(app);
    started.resolve();
    await release.promise;
    return app;
  });
  t.mock.method(NativeApp.prototype, 'close', () => Promise.reject(new Error('fixture cleanup failure')));
  const sessions = new AppSessions();
  const rejectedCreate = assert.rejects(sessions.create({ kind: 'numeric', execution: { profile: 'native-cpu' } }), /shutting down/);
  await bounded(started.promise);
  const stopped = sessions.close();
  const rejectedShutdown = assert.rejects(stopped, error => {
    assert.ok(error instanceof AggregateError);
    assert.match(String(error.errors[0]), /fixture cleanup failure/);
    return true;
  });
  release.resolve();
  await Promise.all([bounded(rejectedCreate), bounded(rejectedShutdown)]);
});

test('closing a suspended native app is bounded and terminal', async t => {
  const app = await NativeApp.start(numericCodec, { executable: resolve('build/numeric-worker'), terminationGraceMs: 50 });
  t.after(async () => { await bounded(app.close()); assertGone(app.pid); });
  process.kill(app.pid, 'SIGSTOP');
  const closing = app.close();
  assert.equal(closing, app.close());
  await assert.rejects(app.command({ kind: 'add', amount: 7 }), { code: 'CLOSED' });
  await bounded(closing);
  assertGone(app.pid);
});

test('a failed session close remains failed and is reported by later gateway shutdown', async t => {
  const realClose = NativeApp.prototype.close;
  t.mock.method(NativeApp.prototype, 'close', async function(this: NativeApp<unknown, unknown>) {
    await realClose.call(this);
    throw new Error('fixture post-close failure');
  });
  const sessions = new AppSessions();
  const created = await sessions.create({ kind: 'numeric', execution: { profile: 'native-cpu' } });
  const pids = sessions.workerPids;
  const failed = sessions.closeSession(created.sessionId);
  await assert.rejects(failed, /fixture post-close failure/);
  assert.equal(sessions.closeSession(created.sessionId), failed);
  await assert.rejects(sessions.close(), AggregateError);
  pids.forEach(assertGone);
});
