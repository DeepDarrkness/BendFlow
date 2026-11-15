import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test, { type TestContext } from 'node:test';
import { NativeApp } from '../../src/app.ts';
import { collectionCodec } from '../../src/protocol/apps.ts';
import { assertGone, bounded } from '../helpers.ts';

const executable = resolve('build/collection-worker');

async function app(t: TestContext) {
  const session = await NativeApp.start(collectionCodec, { executable });
  t.after(async () => { await bounded(session.close()); assertGone(session.pid); });
  return session;
}

test('collection map put get del persist across requests', async t => {
  const session = await app(t);
  assert.deepEqual(await session.command({ kind: 'put', key: 'a', value: 'one' }), { kind: 'ok' });
  assert.deepEqual(await session.command({ kind: 'get', key: 'a' }), { kind: 'text', text: 'one' });
  assert.deepEqual(await session.command({ kind: 'get', key: 'a' }), { kind: 'text', text: 'one' });
  assert.deepEqual(await session.command({ kind: 'get', key: 'missing' }), { kind: 'missing' });
  assert.deepEqual(await session.command({ kind: 'del', key: 'a' }), { kind: 'deleted', text: 'one' });
  assert.deepEqual(await session.command({ kind: 'get', key: 'a' }), { kind: 'missing' });
});

test('collection list mapInc and sort persist affine array edits', async t => {
  const session = await app(t);
  assert.deepEqual(await session.command({ kind: 'setItems', items: [3, 1, 2] }), { kind: 'items', items: [3, 1, 2] });
  assert.deepEqual(await session.command({ kind: 'mapInc' }), { kind: 'items', items: [4, 2, 3] });
  assert.deepEqual(await session.command({ kind: 'sort' }), { kind: 'items', items: [2, 3, 4] });
  assert.deepEqual(await session.command({ kind: 'arraySet', index: 1, value: 9 }), { kind: 'ok' });
  assert.deepEqual(await session.command({ kind: 'arrayGet', index: 1 }), { kind: 'cell', value: 9 });
  assert.deepEqual(await session.command({ kind: 'read' }), { kind: 'items', items: [2, 3, 4] });
});

test('independent collection workers do not share maps', async t => {
  const first = await app(t);
  const second = await app(t);
  await first.command({ kind: 'put', key: 'k', value: 'v' });
  assert.deepEqual(await second.command({ kind: 'get', key: 'k' }), { kind: 'missing' });
});
