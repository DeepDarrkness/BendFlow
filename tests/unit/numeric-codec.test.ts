import assert from 'node:assert/strict';
import test from 'node:test';
import { numericCodec } from '../../src/protocol/apps.ts';
import { numericCommandSchema, numericReplySchema, type NumericCommand, type NumericReply } from '../../contracts/numeric.ts';

const commands: { command: NumericCommand; hex: string }[] = [
  { command: { kind: 'accumulate', amount: '281474976710655' }, hex: '00ffffffffffff' },
  { command: { kind: 'add', amount: 0xffffffff }, hex: '01ffffffff' },
  { command: { kind: 'read' }, hex: '02' },
  { command: { kind: 'reset' }, hex: '03' },
  { command: { kind: 'parse', text: 'é' }, hex: '0402c3a9' },
  { command: { kind: 'show' }, hex: '05' },
  { command: { kind: 'f32Add', left: 0x80000000, right: 0x7f800000 }, hex: '06800000007f800000' },
  { command: { kind: 'compare', left: '0', right: '281474976710655' }, hex: '07000000000000ffffffffffff' },
  { command: { kind: 'bits', op: 'not', left: 0, right: 1 }, hex: '08030000000000000001' },
  { command: { kind: 'calculate', domain: 'nat', op: 'mul', left: '7', right: '2' }, hex: '090002000000000007000000000002' },
  { command: { kind: 'calculate', domain: 'u32', op: 'div', left: 7, right: 2 }, hex: '0901030000000700000002' },
  { command: { kind: 'calculate', domain: 'f32', op: 'mod', left: 0x3f800000, right: 0x40000000 }, hex: '0902043f80000040000000' },
  { command: { kind: 'convert', op: 'natToU32', value: '7' }, hex: '0a00000000000007' },
  { command: { kind: 'convert', op: 'natToF32', value: '7' }, hex: '0a01000000000007' },
  { command: { kind: 'convert', op: 'u32ToNat', value: 7 }, hex: '0a0200000007' },
  { command: { kind: 'convert', op: 'u32ToF32', value: 7 }, hex: '0a0300000007' },
  { command: { kind: 'convert', op: 'f32ToU32', value: 0x3f800000 }, hex: '0a043f800000' },
  { command: { kind: 'convert', op: 'f32ToNat', value: 0x3f800000 }, hex: '0a053f800000' },
  { command: { kind: 'compareNumber', domain: 'nat', op: 'ge', left: '7', right: '2' }, hex: '0b0005000000000007000000000002' },
  { command: { kind: 'compareNumber', domain: 'u32', op: 'eq', left: 7, right: 2 }, hex: '0b01000000000700000002' },
  { command: { kind: 'compareNumber', domain: 'f32', op: 'ne', left: 7, right: 2 }, hex: '0b02010000000700000002' },
  { command: { kind: 'bool', op: 'xor', left: true, right: false }, hex: '0c020100' },
];

const zero = { nat: '0', total: 0, count: 0, f32Bits: 0 };
const replies: { reply: NumericReply; hex: string }[] = [
  { reply: { kind: 'value', value: zero }, hex: '00' + '00'.repeat(18) },
  { reply: { kind: 'overflow', value: { nat: '281474976710655', total: 0xffffffff, count: 1, f32Bits: 0x80000000 } }, hex: '01ffffffffffffffffffff0000000180000000' },
  { reply: { kind: 'invalidText' }, hex: '04' },
  { reply: { kind: 'text', text: 'é' }, hex: '0502c3a9' },
  { reply: { kind: 'order', order: 'lt' }, hex: '0600' },
  { reply: { kind: 'order', order: 'eq' }, hex: '0601' },
  { reply: { kind: 'order', order: 'gt' }, hex: '0602' },
  { reply: { kind: 'bits', value: 0xffffffff }, hex: '07ffffffff' },
  { reply: { kind: 'nat', value: '281474976710655' }, hex: '08ffffffffffff' },
  { reply: { kind: 'bool', value: false }, hex: '0900' },
  { reply: { kind: 'bool', value: true }, hex: '0901' },
  { reply: { kind: 'arithmeticError', reason: 'overflow' }, hex: '0a00' },
  { reply: { kind: 'arithmeticError', reason: 'divisionByZero' }, hex: '0a01' },
  { reply: { kind: 'arithmeticError', reason: 'outOfRange' }, hex: '0a02' },
  { reply: { kind: 'invalidCommand' }, hex: 'ff' },
];

test('numeric codec agrees with hand-specified command bytes', () => {
  assert.equal(numericCodec.encode({ kind: 'read' }).toString('hex'), '02');
  assert.equal(numericCodec.encode({ kind: 'reset' }).toString('hex'), '03');
  assert.equal(numericCodec.encode({ kind: 'add', amount: 7 }).toString('hex'), '0100000007');
  assert.equal(numericCodec.encode({ kind: 'accumulate', amount: '7' }).toString('hex'), '00000000000007');
});

test('numeric codec covers every command and reply golden variant', () => {
  for (const { command, hex } of commands) assert.equal(numericCodec.encode(command).toString('hex'), hex);
  for (const { reply, hex } of replies) assert.deepEqual(numericCodec.decode(Buffer.from(hex, 'hex')), reply);
});

test('numeric named operation selectors have explicit golden bytes', () => {
  for (const [op, selector] of [['add', '00'], ['sub', '01'], ['mul', '02'], ['div', '03'], ['mod', '04']]) {
    for (const [domain, tag, operands] of [['nat', '00', '000000000007000000000002'], ['u32', '01', '0000000700000002'], ['f32', '02', '0000000700000002']]) {
      const command = numericCommandSchema.parse({ kind: 'calculate', domain, op, left: domain === 'nat' ? '7' : 7, right: domain === 'nat' ? '2' : 2 });
      assert.equal(numericCodec.encode(command).toString('hex'), `09${tag}${selector}${operands}`);
    }
  }
  for (const [op, selector] of [['eq', '00'], ['ne', '01'], ['lt', '02'], ['le', '03'], ['gt', '04'], ['ge', '05']]) {
    for (const [domain, tag, operands] of [['nat', '00', '000000000007000000000002'], ['u32', '01', '0000000700000002'], ['f32', '02', '0000000700000002']]) {
      const command = numericCommandSchema.parse({ kind: 'compareNumber', domain, op, left: domain === 'nat' ? '7' : 7, right: domain === 'nat' ? '2' : 2 });
      assert.equal(numericCodec.encode(command).toString('hex'), `0b${tag}${selector}${operands}`);
    }
  }
  for (const [op, selector] of [['and', '00'], ['or', '01'], ['xor', '02'], ['not', '03'], ['shl', '04'], ['shr', '05']]) {
    assert.equal(numericCodec.encode(numericCommandSchema.parse({ kind: 'bits', op, left: 7, right: 2 })).toString('hex'), `08${selector}0000000700000002`);
    if (op !== 'shl' && op !== 'shr') {
      assert.equal(numericCodec.encode(numericCommandSchema.parse({ kind: 'bool', op, left: true, right: false })).toString('hex'), `0c${selector}0100`);
    }
  }
  for (const op of [0, 1, 2]) assert.equal(numericCodec.encode({ kind: 'bits', op, left: 7, right: 2 }).toString('hex'), `080${op}0000000700000002`);
});

test('numeric codec rejects every reply truncation, trailing bytes, and malformed discriminant', () => {
  for (const { hex } of replies) {
    const payload = Buffer.from(hex, 'hex');
    for (let n = 0; n < payload.length; n++) assert.throws(() => numericCodec.decode(payload.subarray(0, n)));
    assert.throws(() => numericCodec.decode(Buffer.concat([payload, Buffer.from([0])])));
  }
  for (const hex of ['02', '03', '0603', '0902', '0a03', '0502c080', '0503eda080', '0504f4908080']) {
    assert.throws(() => numericCodec.decode(Buffer.from(hex, 'hex')));
  }
  assert.deepEqual(numericCodec.decode(Buffer.concat([Buffer.from([5, 96]), Buffer.alloc(96, 97)])), { kind: 'text', text: 'a'.repeat(96) });
  assert.throws(() => numericCodec.decode(Buffer.concat([Buffer.from([5, 97]), Buffer.alloc(97, 97)])));
});

test('numeric strict schemas enforce domains, primitive bounds, Unicode, and complete command limits', () => {
  for (const { command } of commands) {
    assert.equal(numericCommandSchema.safeParse({ ...command, extra: true }).success, false);
    assert.ok(numericCodec.encode(command).length <= 248);
  }
  for (const amount of ['-1', '01', '', '281474976710656', '99999999999999999999']) {
    assert.throws(() => numericCodec.encode(numericCommandSchema.parse({ kind: 'accumulate', amount })));
  }
  for (const amount of [-1, 0x100000000, 1.5, NaN, Infinity]) {
    assert.equal(numericCommandSchema.safeParse({ kind: 'add', amount }).success, false);
  }
  for (const command of [
    { kind: 'calculate', domain: 'nat', op: 'add', left: 1, right: 2 },
    { kind: 'calculate', domain: 'u32', op: 'add', left: '1', right: '2' },
    { kind: 'convert', op: 'f32ToNat', value: '1' },
    { kind: 'convert', op: 'natToF32', value: 1 },
    { kind: 'bits', op: 3, left: 0, right: 0 },
    { kind: 'bool', op: 'and', left: 1, right: false },
    { kind: 'bool', op: 'missing', left: true, right: false },
    { kind: 'parse', text: '\ud800' },
    { kind: 'parse', text: 'é'.repeat(49) },
  ]) assert.equal(numericCommandSchema.safeParse(command).success, false);
  assert.equal(numericCodec.encode({ kind: 'parse', text: 'é'.repeat(48) }).length, 98);
  assert.equal(numericReplySchema.safeParse({ kind: 'nat', value: '281474976710656' }).success, false);
  assert.equal(numericReplySchema.safeParse({ kind: 'value', value: { ...zero, extra: 1 } }).success, false);
});
