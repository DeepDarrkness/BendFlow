import assert from 'node:assert/strict';
import test from 'node:test';
import { app } from '../support/native.ts';
import { f32Bits, f32FromBits } from '../../src/protocol/bytes.ts';
import { numericCodec } from '../../src/protocol/apps.ts';

test('numeric session accumulates nats and u32s independently', async t => {
  const session = await app(t, numericCodec, 'numeric');
  assert.deepEqual(await session.command({ kind: 'accumulate', amount: '7' }), {
    kind: 'value', value: { nat: '7', total: 0, count: 0, f32Bits: 0 },
  });
  assert.deepEqual(await session.command({ kind: 'add', amount: 3 }), {
    kind: 'value', value: { nat: '7', total: 3, count: 1, f32Bits: 0 },
  });
  assert.deepEqual(await session.command({ kind: 'read' }), {
    kind: 'value', value: { nat: '7', total: 3, count: 1, f32Bits: 0 },
  });
  assert.deepEqual(await session.command({ kind: 'show' }), { kind: 'text', text: '7' });
});

test('numeric overflow preserves state and later commands succeed', async t => {
  const session = await app(t, numericCodec, 'numeric');
  await session.command({ kind: 'add', amount: 0xffffffff });
  assert.deepEqual(await session.command({ kind: 'add', amount: 1 }), {
    kind: 'overflow', value: { nat: '0', total: 0xffffffff, count: 1, f32Bits: 0 },
  });
  assert.deepEqual(await session.command({ kind: 'read' }), {
    kind: 'value', value: { nat: '0', total: 0xffffffff, count: 1, f32Bits: 0 },
  });
});

test('numeric parse, compare, bits, and native f32 bits persist', async t => {
  const session = await app(t, numericCodec, 'numeric');
  assert.deepEqual(await session.command({ kind: 'parse', text: '42' }), {
    kind: 'value', value: { nat: '42', total: 0, count: 0, f32Bits: 0 },
  });
  assert.deepEqual(await session.command({ kind: 'parse', text: 'nope' }), { kind: 'invalidText' });
  assert.deepEqual(await session.command({ kind: 'compare', left: '1', right: '2' }), { kind: 'order', order: 'lt' });
  assert.deepEqual(await session.command({ kind: 'bits', op: 1, left: 1, right: 2 }), { kind: 'bits', value: 3 });
  const added = await session.command({ kind: 'f32Add', left: f32Bits(1.5), right: f32Bits(2.25) });
  assert.equal(added.kind, 'value');
  if (added.kind !== 'value') throw new Error('expected value');
  assert.equal(f32FromBits(added.value.f32Bits), 3.75);
  const nan = await session.command({ kind: 'f32Add', left: 0x7fc00000, right: f32Bits(1) });
  assert.equal(nan.kind, 'value');
  if (nan.kind !== 'value') throw new Error('expected value');
  assert.ok(Number.isNaN(f32FromBits(nan.value.f32Bits)));
});

test('malformed numeric payloads leave state unchanged', async t => {
  const session = await app(t, numericCodec, 'numeric');
  await session.command({ kind: 'add', amount: 7 });
  assert.deepEqual(numericCodec.decode(await session.raw(Buffer.from([255]))), { kind: 'invalidCommand' });
  assert.deepEqual(await session.command({ kind: 'read' }), {
    kind: 'value', value: { nat: '0', total: 7, count: 1, f32Bits: 0 },
  });
});
