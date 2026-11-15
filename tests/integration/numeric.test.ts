import assert from 'node:assert/strict';
import test from 'node:test';
import { app } from '../support/native.ts';
import { f32Bits, f32FromBits } from '../../src/protocol/bytes.ts';
import { numericCodec } from '../../src/protocol/apps.ts';
import { arithmeticOps, comparisonOps, bitOps, numericReplySchema, type NumericCommand } from '../../contracts/numeric.ts';
import { MAX_NAT } from '../../contracts/values.ts';
import { gateway } from '../support/gateways.ts';
import { external } from '../support/subprocess.ts';
import { projectPath } from '../../src/paths.ts';

function integerArithmetic(op: 'add' | 'sub' | 'mul' | 'div' | 'mod', a: bigint, b: bigint) {
  switch (op) {
    case 'add': return a + b;
    case 'sub': return a - b;
    case 'mul': return a * b;
    case 'div': return a / b;
    case 'mod': return a % b;
  }
}

function floatArithmetic(op: 'add' | 'sub' | 'mul' | 'div' | 'mod', a: number, b: number) {
  switch (op) {
    case 'add': return a + b;
    case 'sub': return a - b;
    case 'mul': return a * b;
    case 'div': return a / b;
    case 'mod': return a % b;
  }
}

function comparison(op: 'eq' | 'ne' | 'lt' | 'le' | 'gt' | 'ge', a: bigint | number, b: bigint | number) {
  switch (op) {
    case 'eq': return a === b;
    case 'ne': return a !== b;
    case 'lt': return a < b;
    case 'le': return a <= b;
    case 'gt': return a > b;
    case 'ge': return a >= b;
  }
}

function assertFloatBits(actual: number, expected: number) {
  if (Number.isNaN(expected)) {
    assert.equal(actual & 0x7f800000, 0x7f800000);
    assert.notEqual(actual & 0x007fffff, 0);
  } else {
    const oracle = new DataView(new ArrayBuffer(4));
    oracle.setFloat32(0, expected, false);
    assert.equal(actual, oracle.getUint32(0, false));
  }
}

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

test('numeric reset clears all persistent fields, is repeatable, and isolates sessions', async t => {
  const session = await app(t, numericCodec, 'numeric');
  const other = await app(t, numericCodec, 'numeric');
  await session.command({ kind: 'accumulate', amount: '281474976710655' });
  await session.command({ kind: 'add', amount: 23 });
  await session.command({ kind: 'f32Add', left: 0x80000000, right: 0x80000000 });
  await other.command({ kind: 'add', amount: 9 });
  const initial = { kind: 'value', value: { nat: '0', total: 0, count: 0, f32Bits: 0 } };
  assert.deepEqual(await session.command({ kind: 'reset' }), initial);
  assert.deepEqual(await session.command({ kind: 'reset' }), initial);
  assert.deepEqual(await session.command({ kind: 'read' }), initial);
  assert.deepEqual(await other.command({ kind: 'read' }), { kind: 'value', value: { nat: '0', total: 9, count: 1, f32Bits: 0 } });
  assert.deepEqual(await session.command({ kind: 'accumulate', amount: '1' }), { kind: 'value', value: { nat: '1', total: 0, count: 0, f32Bits: 0 } });
});

test('numeric calculate covers all Nat and U32 operations against bigint arithmetic', async t => {
  const session = await app(t, numericCodec, 'numeric');
  await session.command({ kind: 'add', amount: 11 });
  const before = await session.command({ kind: 'read' });
  const pairs: [bigint, bigint][] = [[0n, 0n], [1n, 0n], [0n, 1n], [19n, 7n], [7n, 19n], [MAX_NAT, 1n], [MAX_NAT, MAX_NAT], [1n << 32n, 65535n], [16777217n, 65537n]];
  for (const op of arithmeticOps) {
    for (const [a, b] of pairs) {
      const actual = await session.command({ kind: 'calculate', domain: 'nat', op, left: String(a), right: String(b) });
      if ((op === 'div' || op === 'mod') && b === 0n) {
        assert.deepEqual(actual, { kind: 'arithmeticError', reason: 'divisionByZero' });
      } else {
        let value = integerArithmetic(op, a, b);
        if (value < 0n) value = 0n;
        assert.deepEqual(actual, value > MAX_NAT ? { kind: 'arithmeticError', reason: 'overflow' } : { kind: 'nat', value: String(value) }, `${op}(${a}, ${b})`);
      }
    }
    for (const [a, b] of [[0, 0], [0, 1], [0xffffffff, 1], [0xffffffff, 0xffffffff], [0xfffffffe, 65537], [19, 7], [7, 19]]) {
      assert.ok(a !== undefined && b !== undefined);
      const actual = await session.command({ kind: 'calculate', domain: 'u32', op, left: a, right: b });
      const expected = (op === 'div' || op === 'mod') && b === 0
        ? { kind: 'arithmeticError', reason: 'divisionByZero' }
        : { kind: 'bits', value: Number(BigInt.asUintN(32, integerArithmetic(op, BigInt(a), BigInt(b)))) };
      assert.deepEqual(actual, expected, `${op}(${a}, ${b})`);
    }
  }
  assert.deepEqual(await session.command({ kind: 'read' }), before);
});

test('numeric named comparisons, booleans, and bits agree with independent truth and bit oracles', async t => {
  const session = await app(t, numericCodec, 'numeric');
  for (const op of comparisonOps) {
    for (const [a, b] of [[0n, 0n], [MAX_NAT, 0n], [0n, MAX_NAT], [17n, 19n], [19n, 17n]]) {
      assert.ok(a !== undefined && b !== undefined);
      assert.deepEqual(await session.command({ kind: 'compareNumber', domain: 'nat', op, left: String(a), right: String(b) }), { kind: 'bool', value: comparison(op, a, b) });
    }
    for (const [a, b] of [[0, 0], [0xffffffff, 0], [0, 0xffffffff], [7, 9]]) {
      assert.ok(a !== undefined && b !== undefined);
      assert.deepEqual(await session.command({ kind: 'compareNumber', domain: 'u32', op, left: a, right: b }), { kind: 'bool', value: comparison(op, a, b) });
    }
    for (const [a, b] of [[-0, 0], [Infinity, Infinity], [-Infinity, Infinity], [NaN, 1], [1, NaN], [1.5, 2.5]]) {
      assert.ok(a !== undefined && b !== undefined);
      assert.deepEqual(await session.command({ kind: 'compareNumber', domain: 'f32', op, left: f32Bits(a), right: f32Bits(b) }), { kind: 'bool', value: comparison(op, a, b) });
    }
  }
  for (const op of ['and', 'or', 'xor', 'not'] satisfies Extract<NumericCommand, { kind: 'bool' }>['op'][]) {
    for (const left of [false, true]) for (const right of [false, true]) {
      const value = op === 'and' ? left && right : op === 'or' ? left || right : op === 'xor' ? left !== right : !left;
      assert.deepEqual(await session.command({ kind: 'bool', op, left, right }), { kind: 'bool', value });
    }
  }
  for (const op of bitOps) {
    for (const left of [0, 1, 0x80000000, 0xffffffff, 0xa5a55a5a]) for (const right of [0, 1, 31, 32, 33, 0xffffffff]) {
      const a = BigInt(left), b = BigInt(right);
      const value = op === 'and' ? a & b : op === 'or' ? a | b : op === 'xor' ? a ^ b : op === 'not' ? ~a
        : right >= 32 ? 0n : op === 'shl' ? a << b : a >> b;
      assert.deepEqual(await session.command({ kind: 'bits', op, left, right }), { kind: 'bits', value: Number(BigInt.asUintN(32, value)) });
    }
  }
  for (const [left, right, order] of [['0', '0', 'eq'], ['0', String(MAX_NAT), 'lt'], [String(MAX_NAT), '0', 'gt']]) {
    assert.ok(left !== undefined && right !== undefined);
    assert.deepEqual(await session.command({ kind: 'compare', left, right }), { kind: 'order', order });
  }
});

test('numeric F32 arithmetic preserves native infinities, NaN, signed zero, subnormals, and rounding', async t => {
  const session = await app(t, numericCodec, 'numeric');
  const pairs: [number, number][] = [[-0, -0], [-0, 0], [1, -1], [Infinity, -Infinity], [Infinity, 2], [NaN, 1], [0, 0], [1, 0], [-1, 0], [f32FromBits(1), f32FromBits(1)], [f32FromBits(0x7f7fffff), 2], [16777216, 1], [16777216, 3], [1.5, 2.25], [7.5, 2]];
  for (const op of arithmeticOps) for (const [left, right] of pairs) {
    const actual = await session.command({ kind: 'calculate', domain: 'f32', op, left: f32Bits(left), right: f32Bits(right) });
    assert.equal(actual.kind, 'bits');
    if (actual.kind !== 'bits') throw new Error('expected float bits');
    assertFloatBits(actual.value, floatArithmetic(op, left, right));
  }
  for (const [left, right] of pairs) {
    const actual = await session.command({ kind: 'f32Add', left: f32Bits(left), right: f32Bits(right) });
    assert.equal(actual.kind, 'value');
    if (actual.kind !== 'value') throw new Error('expected snapshot');
    assertFloatBits(actual.value.f32Bits, left + right);
    assert.deepEqual(await session.command({ kind: 'read' }), actual);
  }
  for (const left of [0x7f800001, 0xff800001, 0x7fc12345]) {
    const actual = await session.command({ kind: 'f32Add', left, right: 0x3f800000 });
    assert.equal(actual.kind, 'value');
    if (actual.kind !== 'value') throw new Error('expected snapshot');
    assertFloatBits(actual.value.f32Bits, NaN);
  }
});

test('numeric conversions use full-width Nat, wrapping U32, rounded F32, and guarded truncation', async t => {
  const session = await app(t, numericCodec, 'numeric');
  for (const value of [0n, 1n, 16777217n, 16777219n, 0xffffffffn, 1n << 32n, MAX_NAT]) {
    assert.deepEqual(await session.command({ kind: 'convert', op: 'natToU32', value: String(value) }), { kind: 'bits', value: Number(BigInt.asUintN(32, value)) });
    const float = await session.command({ kind: 'convert', op: 'natToF32', value: String(value) });
    assert.equal(float.kind, 'bits');
    if (float.kind !== 'bits') throw new Error('expected float bits');
    assertFloatBits(float.value, Number(value));
  }
  for (const value of [0, 1, 16777217, 0xffffffff]) {
    assert.deepEqual(await session.command({ kind: 'convert', op: 'u32ToNat', value }), { kind: 'nat', value: String(value) });
    const float = await session.command({ kind: 'convert', op: 'u32ToF32', value });
    assert.equal(float.kind, 'bits');
    if (float.kind !== 'bits') throw new Error('expected float bits');
    assertFloatBits(float.value, value);
  }
  for (const op of ['f32ToU32', 'f32ToNat'] satisfies Extract<NumericCommand, { kind: 'convert'; value: number }>['op'][]) {
    const limit = op === 'f32ToU32' ? 2 ** 32 : 2 ** 48;
    for (const value of [-0, 0, f32FromBits(1), 1.75, 4294967040, 2 ** 32, 281474959933440, 2 ** 48, -1, NaN, Infinity, -Infinity]) {
      const actual = await session.command({ kind: 'convert', op, value: f32Bits(value) });
      const expected = !Number.isFinite(value) || value < 0 || value >= limit
        ? { kind: 'arithmeticError', reason: 'outOfRange' }
        : op === 'f32ToU32' ? { kind: 'bits', value: Math.trunc(value) || 0 } : { kind: 'nat', value: String(Math.trunc(value)) };
      assert.deepEqual(actual, expected, `${op}(${value})`);
    }
  }
  assert.deepEqual(await session.command({ kind: 'add', amount: 1 }), { kind: 'value', value: { nat: '0', total: 1, count: 1, f32Bits: 0 } });
});

test('numeric native Nat zero/max and oversized decimal guards preserve state before overflow', async t => {
  const session = await app(t, numericCodec, 'numeric');
  await session.command({ kind: 'add', amount: 0xffffffff });
  await session.command({ kind: 'accumulate', amount: String(MAX_NAT) });
  const before = await session.command({ kind: 'read' });
  assert.equal(before.kind, 'value');
  if (before.kind !== 'value') throw new Error('expected snapshot');
  assert.deepEqual(await session.command({ kind: 'accumulate', amount: '0' }), before);
  assert.deepEqual(await session.command({ kind: 'accumulate', amount: '1' }), { kind: 'overflow', value: before.value });
  assert.deepEqual(await session.command({ kind: 'add', amount: 1 }), { kind: 'overflow', value: before.value });
  assert.deepEqual(await session.command({ kind: 'show' }), { kind: 'text', text: String(MAX_NAT) });
  await assert.rejects(session.command({ kind: 'accumulate', amount: String(MAX_NAT + 1n) }));
  await assert.rejects(session.command({ kind: 'add', amount: 0x100000000 }));
  assert.deepEqual(await session.command({ kind: 'read' }), before);
  for (const text of [String(MAX_NAT + 1n), '999999999999999', '9'.repeat(96), '-1', '+1', '1x', '', 'é', ' 1', '1 ']) {
    assert.deepEqual(await session.command({ kind: 'parse', text }), { kind: 'invalidText' }, text);
    assert.deepEqual(await session.command({ kind: 'read' }), before);
  }
  assert.equal((await session.command({ kind: 'parse', text: String(MAX_NAT) })).kind, 'value');
  assert.equal((await session.command({ kind: 'parse', text: '0'.repeat(96) })).kind, 'value');
  assert.deepEqual(await session.command({ kind: 'show' }), { kind: 'text', text: '0' });
  assert.deepEqual(await session.command({ kind: 'accumulate', amount: '1' }), { kind: 'value', value: { nat: '1', total: 0xffffffff, count: 1, f32Bits: 0 } });
});

test('numeric raw command truncations, trailing bytes, invalid tags and limits never mutate state', async t => {
  const session = await app(t, numericCodec, 'numeric');
  await session.command({ kind: 'add', amount: 23 });
  const before = await session.command({ kind: 'read' });
  const commands: NumericCommand[] = [
    { kind: 'accumulate', amount: '7' }, { kind: 'add', amount: 7 }, { kind: 'read' }, { kind: 'reset' },
    { kind: 'parse', text: '7' }, { kind: 'show' }, { kind: 'f32Add', left: 0, right: 0 },
    { kind: 'compare', left: '0', right: '1' }, { kind: 'bits', op: 'and', left: 1, right: 2 },
    { kind: 'calculate', domain: 'nat', op: 'add', left: '7', right: '2' },
    { kind: 'calculate', domain: 'u32', op: 'sub', left: 7, right: 2 },
    { kind: 'calculate', domain: 'f32', op: 'mul', left: 7, right: 2 },
    { kind: 'convert', op: 'natToF32', value: '7' }, { kind: 'convert', op: 'f32ToNat', value: 7 },
    { kind: 'compareNumber', domain: 'nat', op: 'ge', left: '7', right: '2' },
    { kind: 'compareNumber', domain: 'u32', op: 'ge', left: 7, right: 2 },
    { kind: 'compareNumber', domain: 'f32', op: 'ge', left: 7, right: 2 },
    { kind: 'bool', op: 'not', left: false, right: true },
  ];
  for (const command of commands) {
    const payload = numericCodec.encode(command);
    for (let n = 0; n < payload.length; n++) assert.deepEqual(numericCodec.decode(await session.raw(payload.subarray(0, n))), { kind: 'invalidCommand' });
    assert.deepEqual(numericCodec.decode(await session.raw(Buffer.concat([payload, Buffer.from([0])]))), { kind: 'invalidCommand' });
  }
  for (const payload of [
    Buffer.from([255]), Buffer.from('08060000000000000000', 'hex'),
    Buffer.from('0001000000000000', 'hex'),
    Buffer.from('0903000000000000000000', 'hex'), Buffer.from('090005000000000000000000000000', 'hex'),
    Buffer.from('0b02060000000000000000', 'hex'), Buffer.from('0a0600000000', 'hex'),
    Buffer.from([12, 4, 0, 1]), Buffer.from([12, 0, 2, 1]), Buffer.from([12, 0, 1, 2]),
    Buffer.concat([Buffer.from([4, 97]), Buffer.alloc(97, 48)]),
    Buffer.from('0402c080', 'hex'), Buffer.from('0403eda080', 'hex'), Buffer.from('0404f4908080', 'hex'),
  ]) assert.deepEqual(numericCodec.decode(await session.raw(payload)), { kind: 'invalidCommand' });
  assert.deepEqual(await session.command({ kind: 'read' }), before);
  assert.deepEqual(await session.command({ kind: 'add', amount: 1 }), { kind: 'value', value: { nat: '0', total: 24, count: 2, f32Bits: 0 } });
});

test('numeric native decoder and reply encoder agree with independent wire golden vectors', async t => {
  const session = await app(t, numericCodec, 'numeric');
  const initial = '00' + '00'.repeat(18);
  const vectors = [
    ['02', initial], ['03', initial], ['00000000000000', initial], ['040130', initial],
    ['05', '050130'], ['040178', '04'],
    ['07000000000000000000000001', '0600'], ['07000000000001000000000001', '0601'], ['07000000000001000000000000', '0602'],
    ['08010000000100000002', '0700000003'],
    ['090000000000000007000000000002', '08000000000009'],
    ['090100ffffffff00000001', '0700000000'],
    ['0902003f80000040000000', '0740400000'],
    ['090000ffffffffffff000000000001', '0a00'],
    ['090003000000000007000000000000', '0a01'],
    ['0a00000000000007', '0700000007'], ['0a01000000000007', '0740e00000'],
    ['0a0200000007', '08000000000007'], ['0a0300000007', '0740e00000'],
    ['0a043fe00000', '0700000001'], ['0a053fe00000', '08000000000001'], ['0a047f800000', '0a02'],
    ['0b0000000000000007000000000007', '0901'], ['0b01020000000700000002', '0900'], ['0b02013f80000040000000', '0901'],
    ['0c000100', '0900'], ['0c020100', '0901'], ['ff', 'ff'],
    ['0100000007', '00000000000000000000070000000100000000'],
    ['068000000080000000', '00000000000000000000070000000180000000'],
    ['01ffffffff', '01000000000000000000070000000180000000'],
    ['03', initial],
  ];
  for (const [command, reply] of vectors) {
    assert.ok(command !== undefined && reply !== undefined);
    assert.equal((await session.raw(Buffer.from(command, 'hex'))).toString('hex'), reply, command);
  }
});

test('external HTTP numeric client exercises expanded operations, guarded failure, and reset', async t => {
  const server = await gateway(t);
  const script = `
    import { createAppClient } from ${JSON.stringify(projectPath('src/client.ts'))};
    const client = createAppClient(process.argv[1]);
    const { sessionId } = await client.sessions.create({ kind: 'numeric' });
    const commands = [
      { kind: 'add', amount: 7 },
      { kind: 'calculate', domain: 'u32', op: 'add', left: 4294967295, right: 1 },
      { kind: 'convert', op: 'natToF32', value: '281474976710655' },
      { kind: 'compareNumber', domain: 'f32', op: 'ne', left: 2143289344, right: 1065353216 },
      { kind: 'bool', op: 'xor', left: true, right: false },
      { kind: 'bits', op: 'shr', left: 4294967295, right: 31 },
      { kind: 'convert', op: 'f32ToNat', value: 2139095040 },
      { kind: 'read' }, { kind: 'reset' }, { kind: 'read' }
    ];
    const replies = [];
    for (const command of commands) replies.push(await client.numeric.command({ sessionId, command }));
    await client.sessions.close({ sessionId });
    process.stdout.write(process.pid + '\\n' + JSON.stringify(replies));
  `;
  const result = await external(process.execPath, ['--input-type=module', '-e', script, server.url], { timeout: 10_000 });
  assert.equal(result.stderr, '');
  const [pid, json] = result.stdout.split('\n');
  assert.notEqual(Number(pid), process.pid);
  assert.ok(json !== undefined);
  const replies = numericReplySchema.array().parse(JSON.parse(json));
  const retained = { kind: 'value', value: { nat: '0', total: 7, count: 1, f32Bits: 0 } };
  const initial = { kind: 'value', value: { nat: '0', total: 0, count: 0, f32Bits: 0 } };
  assert.deepEqual(replies, [retained, { kind: 'bits', value: 0 }, { kind: 'bits', value: 0x57800000 },
    { kind: 'bool', value: true }, { kind: 'bool', value: true }, { kind: 'bits', value: 1 },
    { kind: 'arithmeticError', reason: 'outOfRange' }, retained, initial, initial]);
  assert.equal(server.workerPids.length, 0);
});
