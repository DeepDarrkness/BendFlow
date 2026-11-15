import assert from 'node:assert/strict';
import test from 'node:test';
import { app } from '../support/native.ts';
import { computeCodec } from '../../src/protocol/apps.ts';

test('compute sum is independent of thread profile', async t => {
  const one = await app(t, computeCodec, 'compute', { profile: 'native-cpu', threads: 1 });
  const many = await app(t, computeCodec, 'compute', { profile: 'multithreaded-cpu', threads: 4 });
  assert.deepEqual(await one.command({ kind: 'sum', items: [1, 2, 3, 4] }), { kind: 'sum', value: 10 });
  assert.deepEqual(await many.command({ kind: 'sum', items: [1, 2, 3, 4] }), { kind: 'sum', value: 10 });
  const threads = await many.command({ kind: 'threads' });
  assert.equal(threads.kind, 'threads');
  if (threads.kind !== 'threads') throw new Error('expected threads');
  assert.equal(threads.value, 4);
  assert.deepEqual(await one.command({ kind: 'frame' }), { kind: 'pixels', items: [1, 2, 3, 4] });
});
