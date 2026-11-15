import assert from 'node:assert/strict';
import test from 'node:test';
import { customCodec } from '../../src/protocol/codecs/custom.ts';
import type { CustomCommand, CustomReply } from '../../contracts/custom.ts';
import { BytesWriter } from '../../src/protocol/bytes.ts';

test('custom codec has exact golden vectors for every fixed command and returned constructor', () => {
  const commands: [CustomCommand, string][] = [
    [{ kind: 'mark', path: 'é' }, '0002c3a9'],
    [{ kind: 'immediate', value: 0xffffffff }, '01ffffffff'],
    [{ kind: 'write', path: 'p', text: 'é\0' }, '03017003c3a900'],
    [{ kind: 'write', path: 'p', text: '' }, '03017000'],
    [{ kind: 'parked', milliseconds: 10000, value: 0x01020304 }, '040000271001020304'],
    [{ kind: 'history', offset: 0 }, '0500000000'],
    [{ kind: 'history', offset: 32 }, '0500000020'],
  ];
  for (const [command, hex] of commands) assert.equal(customCodec.encode(customCodec.parse(command)).toString('hex'), hex);
  const replies: [CustomReply, string][] = [
    [{ kind: 'marked', value: 7 }, '0000000007'],
    [{ kind: 'immediate', value: 0xffffffff }, '01ffffffff'],
    [{ kind: 'written', value: 0 }, '0300000000'],
    [{ kind: 'parked', value: 42 }, '040000002a'],
    [{ kind: 'fail', code: 2, message: 'é' }, '020000000202c3a9'],
    [{ kind: 'invalidCommand' }, 'ff'],
    [{ kind: 'history', offset: 0, total: 0, results: [] }, '05000000000000000000'],
    [{ kind: 'history', offset: 0, total: 2, results: [{ kind: 'fail', code: 2, message: 'é' }, { kind: 'written', value: 7 }] }, '05000000000000000202020000000202c3a90300000007'],
  ];
  for (const [reply, hex] of replies) assert.deepEqual(customCodec.decode(Buffer.from(hex, 'hex')), reply);
});

test('custom codec rejects every truncated and trailing golden result and malformed nested history', () => {
  const vectors = ['0000000007', '01ffffffff', '0300000000', '040000002a', '020000000202c3a9', 'ff', '05000000000000000000', '05000000000000000202020000000202c3a90300000007'];
  for (const hex of vectors) {
    const bytes = Buffer.from(hex, 'hex');
    for (let n = 0; n < bytes.length; n++) assert.throws(() => customCodec.decode(bytes.subarray(0, n)), hex);
    assert.throws(() => customCodec.decode(Buffer.concat([bytes, Buffer.from([0])])), hex);
  }
  for (const hex of ['06', '0501ff', '05010500', '0521', '020000000201ff', '020000000202c0af', '020000000203eda080', '0501020000000201ff']) {
    assert.throws(() => customCodec.decode(Buffer.from(hex, 'hex')), hex);
  }
  for (const hex of ['05000000000000000101ff', '0500000000000000010105', '05000000000000000303', '05000000000000002100', '05000000210000002000']) {
    assert.throws(() => customCodec.decode(Buffer.from(hex, 'hex')), hex);
  }
  assert.throws(() => customCodec.decode(Buffer.concat([Buffer.from('020000000261', 'hex'), Buffer.alloc(97, 97)])));
});

test('custom codec enforces input bounds and full output bounds', () => {
  for (const input of [
    { kind: 'mark', path: '' }, { kind: 'mark', path: 'a\0' }, { kind: 'mark', path: 'a'.repeat(97) },
    { kind: 'mark', path: '\ud800' }, { kind: 'mark', path: 'p', extra: 1 }, { kind: 'eval', source: 'code' },
    { kind: 'immediate', value: -1 }, { kind: 'immediate', value: 0x100000000 }, { kind: 'immediate', value: 1.5 },
    { kind: 'write', path: 'p', text: 'a'.repeat(150) }, { kind: 'write', path: 'p', text: '\udfff' },
    { kind: 'parked', milliseconds: 10001, value: 1 }, { kind: 'parked', milliseconds: -1, value: 1 },
    { kind: 'parked', milliseconds: 1 }, { kind: 'history', extra: true }, { kind: 'history', offset: 33 },
    { kind: 'history', offset: -1 }, { kind: 'history', offset: 1.5 },
  ]) assert.throws(() => customCodec.parse(input));
  assert.equal(customCodec.encode(customCodec.parse({ kind: 'write', path: 'p'.repeat(96), text: 'é'.repeat(74) + 'x' })).length, 248);
  const error = new BytesWriter().u8(2).u32(0xffffffff).text('é'.repeat(48)).toBuffer();
  const payload = Buffer.concat([Buffer.from('050000001e0000002002', 'hex'), error, error]);
  const reply = customCodec.decode(payload);
  assert.equal(payload.length, 214);
  assert.equal(reply.kind, 'history');
  if (reply.kind !== 'history') throw new Error('Expected history');
  assert.equal(reply.results.length, 2);
  assert.deepEqual(reply.results, Array.from({ length: 2 }, () => ({ kind: 'fail', code: 0xffffffff, message: 'é'.repeat(48) })));
  assert.throws(() => customCodec.decode(Buffer.from('05000000010000000000', 'hex')));
  assert.throws(() => customCodec.decode(Buffer.from('05000000000000000200', 'hex')));
  assert.deepEqual(customCodec.parse({ kind: 'history' }), { kind: 'history', offset: 0 });
});
