import assert from 'node:assert/strict';
import test from 'node:test';
import { app } from '../support/native.ts';
import { collectionCodec } from '../../src/protocol/apps.ts';

test('collection map put get del persist across requests', async t => {
  const session = await app(t, collectionCodec, 'collection');
  assert.deepEqual(await session.command({ kind: 'put', key: 'a', value: 'one' }), { kind: 'ok' });
  assert.deepEqual(await session.command({ kind: 'get', key: 'a' }), { kind: 'text', text: 'one' });
  assert.deepEqual(await session.command({ kind: 'get', key: 'a' }), { kind: 'text', text: 'one' });
  assert.deepEqual(await session.command({ kind: 'get', key: 'missing' }), { kind: 'missing' });
  assert.deepEqual(await session.command({ kind: 'del', key: 'a' }), { kind: 'deleted', text: 'one' });
  assert.deepEqual(await session.command({ kind: 'get', key: 'a' }), { kind: 'missing' });
});

test('collection list mapInc and sort persist affine array edits', async t => {
  const session = await app(t, collectionCodec, 'collection');
  assert.deepEqual(await session.command({ kind: 'setItems', items: [3, 1, 2] }), { kind: 'items', items: [3, 1, 2] });
  assert.deepEqual(await session.command({ kind: 'mapInc' }), { kind: 'items', items: [4, 2, 3] });
  assert.deepEqual(await session.command({ kind: 'sort' }), { kind: 'items', items: [2, 3, 4] });
  assert.deepEqual(await session.command({ kind: 'arraySet', index: 1, value: 9 }), { kind: 'ok' });
  assert.deepEqual(await session.command({ kind: 'arrayGet', index: 1 }), { kind: 'cell', value: 9 });
  assert.deepEqual(await session.command({ kind: 'read' }), { kind: 'items', items: [2, 3, 4] });
});

test('independent collection workers do not share maps', async t => {
  const first = await app(t, collectionCodec, 'collection');
  const second = await app(t, collectionCodec, 'collection');
  await first.command({ kind: 'put', key: 'k', value: 'v' });
  assert.deepEqual(await second.command({ kind: 'get', key: 'k' }), { kind: 'missing' });
});

test('native collection decoder rejects overlong, surrogate, and out-of-range UTF-8 without mutation', async t => {
  const session = await app(t, collectionCodec, 'collection');
  await session.command({ kind: 'put', key: 'k', value: 'kept' });
  for (const bytes of [
    [0xe0, 0x81, 0x81], [0xed, 0xa0, 0x80], [0xf0, 0x80, 0x81, 0x81], [0xf4, 0x90, 0x80, 0x80],
    [0xc0, 0x81], [0xe1, 0x80], [0x80],
  ]) {
    const payload = Buffer.from([0, 1, 107, bytes.length, ...bytes]);
    assert.deepEqual(collectionCodec.decode(await session.raw(payload)), { kind: 'invalidCommand' });
    assert.deepEqual(await session.command({ kind: 'get', key: 'k' }), { kind: 'text', text: 'kept' });
  }
  for (const text of ['\u07ff', '\u0800', '\ud7ff', '\ue000', '\uffff', '\u{10000}', '\u{10ffff}', '\ufeff']) {
    await session.command({ kind: 'put', key: 'k', value: text });
    assert.deepEqual(await session.command({ kind: 'get', key: 'k' }), { kind: 'text', text });
  }
});
