import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test, { type TestContext } from 'node:test';
import { NativeApp } from '../../src/app.ts';
import { computeCodec } from '../../src/protocol/apps.ts';
import { assertGone, bounded } from '../helpers.ts';

const executable = resolve('build/compute-worker');

async function app(t: TestContext, threads?: number) {
  const session = await NativeApp.start(computeCodec, {
    executable, profile: threads && threads > 1 ? 'multithreaded-cpu' : 'native-cpu', threads: threads ?? 1,
  });
  t.after(async () => { await bounded(session.close()); assertGone(session.pid); });
  return session;
}

test('compute sum is independent of thread profile', async t => {
  const one = await app(t, 1);
  const many = await app(t, 4);
  assert.deepEqual(await one.command({ kind: 'sum', items: [1, 2, 3, 4] }), { kind: 'sum', value: 10 });
  assert.deepEqual(await many.command({ kind: 'sum', items: [1, 2, 3, 4] }), { kind: 'sum', value: 10 });
  const threads = await many.command({ kind: 'threads' });
  assert.equal(threads.kind, 'threads');
  if (threads.kind !== 'threads') throw new Error('expected threads');
  assert.equal(threads.value, 4);
  assert.deepEqual(await one.command({ kind: 'frame' }), { kind: 'pixels', items: [1, 2, 3, 4] });
});
