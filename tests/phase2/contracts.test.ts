import assert from 'node:assert/strict';
import test from 'node:test';
import { fileCommandSchema } from '../../contracts/file.ts';
import { collectionCommandSchema } from '../../contracts/collection.ts';
import { networkCodec, taskCodec, processCodec, computeCodec, customCodec } from '../../src/protocol/apps.ts';
import { BytesReader, BytesWriter } from '../../src/protocol/bytes.ts';

test('every native command boundary rejects unsupported shapes before dispatch', () => {
  for (const codec of [networkCodec, taskCodec, processCodec, computeCodec, customCodec]) {
    for (const input of [null, {}, { kind: 'eval' }, { kind: 'frame', extra: true }]) {
      assert.throws(() => codec.parse(input));
    }
  }
});

test('file read bounds and text bounds match the wire rather than JS string length', () => {
  assert.equal(fileCommandSchema.safeParse({ kind: 'read', id: 1, max: 192 }).success, true);
  assert.equal(fileCommandSchema.safeParse({ kind: 'read', id: 1, max: 193 }).success, false);
  assert.equal(fileCommandSchema.safeParse({ kind: 'read', id: 0, max: 1 }).success, false);
  assert.equal(collectionCommandSchema.safeParse({ kind: 'put', key: '😀'.repeat(24), value: '' }).success, true);
  assert.equal(collectionCommandSchema.safeParse({ kind: 'put', key: '😀'.repeat(25), value: '' }).success, false);
  assert.equal(collectionCommandSchema.safeParse({ kind: 'put', key: '\ud800', value: '' }).success, false);
});

test('text decoding rejects invalid UTF-8 even when replacement preserves byte count', () => {
  assert.throws(() => new BytesReader(Buffer.from([3, 0xed, 0xa0, 0x80])).text());
  assert.throws(() => new BytesReader(Buffer.from([3, 0xe0, 0x80, 0x80])).text());
  assert.throws(() => new BytesWriter().text('\ud800'));
  assert.equal(new BytesReader(new BytesWriter().text('😀é').toBuffer()).text(), '😀é');
});
