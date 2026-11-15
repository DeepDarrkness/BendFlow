import assert from 'node:assert/strict';
import test from 'node:test';
import { computeCodec } from '../../src/protocol/codecs/compute.ts';
import { computeCommandSchema, computeReplySchema, type ComputeCommand, type ComputeReply } from '../../contracts/compute.ts';
import { BytesWriter } from '../../src/protocol/bytes.ts';
import { collectionCodec } from '../../src/protocol/codecs/collection.ts';
import { fileCodec } from '../../src/protocol/codecs/file.ts';

test('compute codec command golden vectors cover every command and declared event', () => {
  const vectors: [ComputeCommand, string][] = [
    [{ kind: 'sum', items: [1, 0xffffffff] }, '000200000001ffffffff'], [{ kind: 'threads' }, '01'], [{ kind: 'frame' }, '02'],
    [{ kind: 'sort', items: [] }, '0300'], [{ kind: 'advance', steps: 1024 }, '0400000400'], [{ kind: 'inspect' }, '05'], [{ kind: 'reset' }, '06'],
    [{ kind: 'event', event: { kind: 'key', code: 32, down: true } }, '07000000002001'],
    [{ kind: 'event', event: { kind: 'focus', on: false } }, '070100'], [{ kind: 'event', event: { kind: 'close' } }, '0702'],
    [{ kind: 'render', depth: 4 }, '0800000004'], [{ kind: 'samples', count: 512 }, '0900000200'],
    [{ kind: 'page', snapshot: 1, offset: 512, max: 32 }, '0a000000010000020000000020'], [{ kind: 'release', snapshot: 1 }, '0b00000001'],
  ];
  for (const [command, hex] of vectors) assert.equal(computeCodec.encode(command).toString('hex'), hex);
});

test('compute codec reply golden vectors enforce all metadata and variants', () => {
  const vectors: [string, ComputeReply][] = [
    ['ff', { kind: 'invalidCommand' }], ['00ffffffff', { kind: 'sum', value: 0xffffffff }], ['0100000004', { kind: 'threads', value: 4 }],
    ['020100000001', { kind: 'pixels', items: [1] }], ['0300', { kind: 'sorted', items: [] }],
    ['040000000100000001000000010100', { kind: 'simulation', tick: 1, position: 1, velocity: 1, running: true, closed: false }],
    ['060000000100000200', { kind: 'snapshot', snapshot: 1, total: 512 }],
    ['07000000010000020000000200000000000100', { kind: 'page', snapshot: 1, offset: 512, total: 512, count: 0, done: true, data: [] }],
    ['05', { kind: 'ok' }], ['0800', { kind: 'error', reason: 'busy' }], ['0801', { kind: 'error', reason: 'stale' }],
    ['0802', { kind: 'error', reason: 'range' }], ['0803', { kind: 'error', reason: 'exhausted' }], ['0804', { kind: 'error', reason: 'overflow' }],
  ];
  for (const [hex, reply] of vectors) {
    const raw = Buffer.from(hex, 'hex');
    assert.deepEqual(computeCodec.decode(raw), reply);
    if (reply.kind === 'snapshot' || reply.kind === 'page') assert.deepEqual(collectionCodec.decode(raw), reply);
    if (reply.kind === 'snapshot') assert.deepEqual(fileCodec.decode(raw), reply);
    assert.throws(() => computeCodec.decode(Buffer.concat([raw, Buffer.from([0])])));
    for (let i = 0; i < raw.length; i++) assert.throws(() => computeCodec.decode(raw.subarray(0, i)));
  }
  const page = new BytesWriter().u8(7).u32(1).u32(0).u32(32).u32(32).u8(1).u32s(Array(32).fill(0xffffffff)).toBuffer();
  assert.equal(page.length, 147);
  assert.equal(computeCodec.decode(page).kind, 'page');
  for (const raw of [Buffer.from([254]), Buffer.from([8, 5]), Buffer.from([1, 0, 0, 0, 0]),
    new BytesWriter().u8(7).u32(1).u32(0).u32(1).u32(0).u8(0).u32s([]).toBuffer(),
    new BytesWriter().u8(7).u32(1).u32(1).u32(0).u32(0).u8(1).u32s([]).toBuffer(),
    new BytesWriter().u8(7).u32(1).u32(0).u32(1).u32(1).u8(2).u32s([1]).toBuffer()]) assert.throws(() => computeCodec.decode(raw));
});

test('compute contract rejects one-over bounds, invalid IDs, booleans and extra fields', () => {
  for (const input of [{ kind: 'sum', items: Array(33).fill(0) }, { kind: 'sort', items: [-1] },
    { kind: 'advance', steps: 1025 }, { kind: 'render', depth: 5 }, { kind: 'samples', count: 513 },
    { kind: 'page', snapshot: 0, offset: 0, max: 32 }, { kind: 'page', snapshot: 1, offset: 0, max: 0 },
    { kind: 'page', snapshot: 1, offset: 0, max: 33 }, { kind: 'release', snapshot: 0 },
    { kind: 'event', event: { kind: 'focus', on: 1 } }, { kind: 'inspect', extra: true }]) assert.equal(computeCommandSchema.safeParse(input).success, false);
  for (const input of [{ kind: 'captured', snapshot: 1, total: 0 }, { kind: 'snapshot', snapshot: 1, total: 513 },
    { kind: 'page', snapshot: 1, offset: 0, total: 0, count: 0, done: true, items: [] },
    { kind: 'page', snapshot: 1, offset: 0, total: 1, count: 1, done: true, data: [-1] },
    { kind: 'page', snapshot: 1, offset: 0, total: 0, count: 0, done: true, data: [], extra: true }]) {
    assert.equal(computeReplySchema.safeParse(input).success, false);
  }
});
