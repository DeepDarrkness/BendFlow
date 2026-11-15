import assert from 'node:assert/strict';
import test from 'node:test';
import { app } from '../support/native.ts';
import { computeCodec } from '../../src/protocol/apps.ts';
import { COMPUTE_MAX_TOTAL, type ComputeCommand, type ComputeReply } from '../../contracts/compute.ts';
import { BytesWriter, f32FromBits } from '../../src/protocol/bytes.ts';
import { collectSnapshot } from '../../contracts/pages.ts';

type Command = (command: ComputeCommand) => Promise<ComputeReply>;
const initial = { kind: 'simulation', tick: 0, position: 0, velocity: 1, running: true, closed: false };

test('compute sum is independent of thread profile', async t => {
  const one = await app(t, computeCodec, 'compute', { profile: 'native-cpu', threads: 1 });
  const many = await app(t, computeCodec, 'compute', { profile: 'multithreaded-cpu', threads: 4 });
  assert.deepEqual(await one.command({ kind: 'sum', items: [1, 2, 3, 4] }), { kind: 'sum', value: 10 });
  assert.deepEqual(await many.command({ kind: 'sum', items: [1, 2, 3, 4] }), { kind: 'sum', value: 10 });
  assert.deepEqual(await many.command({ kind: 'threads' }), { kind: 'threads', value: 4 });
  assert.deepEqual(await one.command({ kind: 'frame' }), { kind: 'pixels', items: [1, 2, 3, 4] });
});

function pixels(depth: number, tick: number, position: number, x = 0, y = 0, side = 2 ** depth): number[] {
  if (depth === 0) return [(((x + position) % 256) * 2 ** 24 + ((y + tick) % 256) * 2 ** 16
    + ((x + 17 * y + 31 * tick) % 256) * 256 + 255) >>> 0];
  const h = side / 2;
  return [...pixels(depth - 1, tick, position, x, y, h), ...pixels(depth - 1, tick, position, x + h, y, h),
    ...pixels(depth - 1, tick, position, x, y + h, h), ...pixels(depth - 1, tick, position, x + h, y + h, h)];
}

async function reassemble(command: Command, descriptor: Extract<ComputeReply, { kind: 'snapshot' }>, max: number): Promise<number[]> {
  const { snapshot, total } = descriptor;
  const result = await collectSnapshot({ descriptor, totalLimit: COMPUTE_MAX_TOTAL, pageCap: max,
    read: async (offset, max) => {
      const page = await command({ kind: 'page', snapshot, offset, max });
      if (page.kind !== 'page') throw new Error('expected page');
      assert.equal(page.count, Math.min(max, total - offset));
      return page;
    },
  });
  assert.deepEqual(await command({ kind: 'page', snapshot, offset: total, max }),
    { kind: 'page', snapshot, offset: total, total, count: 0, done: true, data: [] });
  assert.deepEqual(await command({ kind: 'page', snapshot, offset: total + 1, max }), { kind: 'error', reason: 'range' });
  assert.deepEqual(await command({ kind: 'page', snapshot, offset: 0xffffffff, max }), { kind: 'error', reason: 'range' });
  return result;
}

for (const threads of [1, 2, 4]) {
  test(`compute balanced sum and sort match independent references on ${threads} threads`, async t => {
    const native = await app(t, computeCodec, 'compute', { profile: threads === 1 ? 'native-cpu' : 'multithreaded-cpu', threads });
    assert.deepEqual(await native.command({ kind: 'threads' }), { kind: 'threads', value: threads });
    const cases = [[], [0], [0xffffffff], [0xffffffff, 1], [7, 7, 0, 3, 0xffffffff],
      Array.from({ length: 31 }, (_, i) => (31 - i) * 37), Array.from({ length: 32 }, (_, i) => (i * 0x1234567) >>> 0),
      Array.from({ length: 32 }, (_, i) => 32 - i), Array(32).fill(9)];
    for (const items of cases) {
      assert.deepEqual(await native.command({ kind: 'sum', items }), { kind: 'sum', value: Number(items.reduce((a, b) => a + BigInt(b), 0n) & 0xffffffffn) });
      assert.deepEqual(await native.command({ kind: 'sort', items }), { kind: 'sorted', items: [...items].sort((a, b) => a - b) });
    }
    assert.deepEqual(await native.command({ kind: 'frame' }), { kind: 'pixels', items: [1, 2, 3, 4] });
  });

  test(`compute simulation events and retained rendering match reference on ${threads} threads`, async t => {
    const native = await app(t, computeCodec, 'compute', { profile: threads === 1 ? 'native-cpu' : 'multithreaded-cpu', threads });
    const command: Command = c => native.command(c);
    assert.deepEqual(await command({ kind: 'threads' }), { kind: 'threads', value: threads });
    assert.deepEqual(await command({ kind: 'inspect' }), initial);
    assert.deepEqual(await command({ kind: 'advance', steps: 0 }), initial);
    assert.deepEqual(await command({ kind: 'advance', steps: 257 }), { ...initial, tick: 257, position: 1 });
    assert.deepEqual(await command({ kind: 'event', event: { kind: 'key', code: 39, down: true } }), { ...initial, tick: 257, position: 1, velocity: 2 });
    assert.deepEqual(await command({ kind: 'advance', steps: 17 }), { ...initial, tick: 274, position: 35, velocity: 2 });
    const captured = await command({ kind: 'render', depth: 4 });
    if (captured.kind !== 'snapshot') throw new Error('expected snapshot');
    assert.equal(captured.total, 256);
    assert.deepEqual(await command({ kind: 'render', depth: 0 }), { kind: 'error', reason: 'busy' });
    assert.deepEqual(await command({ kind: 'samples', count: 512 }), { kind: 'error', reason: 'busy' });
    await command({ kind: 'advance', steps: 1 });
    await command({ kind: 'reset' });
    assert.deepEqual(await reassemble(command, captured, 13), pixels(4, 274, 35));
    assert.deepEqual(await reassemble(command, captured, 32), pixels(4, 274, 35));
    assert.deepEqual(await command({ kind: 'release', snapshot: captured.snapshot + 1 }), { kind: 'error', reason: 'stale' });
    assert.deepEqual(await command({ kind: 'release', snapshot: captured.snapshot }), { kind: 'ok' });
    assert.deepEqual(await command({ kind: 'page', snapshot: captured.snapshot, offset: 0, max: 32 }), { kind: 'error', reason: 'stale' });
    assert.deepEqual(await command({ kind: 'release', snapshot: captured.snapshot }), { kind: 'error', reason: 'stale' });
    for (const depth of [0, 1, 2, 3, 4]) {
      const frame = await command({ kind: 'render', depth });
      if (frame.kind !== 'snapshot') throw new Error('expected snapshot');
      assert.ok(frame.snapshot > captured.snapshot);
      assert.equal(frame.total, 4 ** depth);
      assert.deepEqual(await reassemble(command, frame, 32), pixels(depth, 0, 0));
      await command({ kind: 'release', snapshot: frame.snapshot });
    }
    for (const event of [{ kind: 'focus', on: false }, { kind: 'key', code: 32, down: true }, { kind: 'close' }] satisfies Extract<ComputeCommand, { kind: 'event' }>['event'][]) {
      await command({ kind: 'event', event });
      const before = await command({ kind: 'inspect' });
      const after = await command({ kind: 'advance', steps: 5 });
      if (event.kind === 'focus' || event.kind === 'close') assert.deepEqual(after, before);
      else assert.deepEqual(after, { ...initial, tick: 5, position: 5 });
    }
    const closed = await command({ kind: 'event', event: { kind: 'focus', on: true } });
    assert.deepEqual(await command({ kind: 'advance', steps: 5 }), closed);
    assert.deepEqual(await command({ kind: 'reset' }), initial);
    assert.deepEqual(await command({ kind: 'event', event: { kind: 'key', code: 99, down: true } }), initial);
    assert.deepEqual(await command({ kind: 'event', event: { kind: 'key', code: 32, down: false } }), initial);
    assert.deepEqual(await command({ kind: 'event', event: { kind: 'key', code: 39, down: true } }), { ...initial, velocity: 2 });
    assert.deepEqual(await command({ kind: 'event', event: { kind: 'key', code: 39, down: false } }), initial);
    for (let i = 0; i < 9; i++) await command({ kind: 'advance', steps: 1024 });
    assert.deepEqual(await command({ kind: 'advance', steps: 784 }), { ...initial, tick: 10000, position: 16 });
    assert.deepEqual(await command({ kind: 'advance', steps: 1 }), { kind: 'error', reason: 'overflow' });
    assert.deepEqual(await command({ kind: 'inspect' }), { ...initial, tick: 10000, position: 16 });
    assert.deepEqual(await command({ kind: 'reset' }), initial);
    const other = await app(t, computeCodec, 'compute', { threads });
    await command({ kind: 'advance', steps: 19 });
    assert.deepEqual(await other.command({ kind: 'inspect' }), initial);
  });

  test(`compute deterministic F32 samples reassemble with tolerance on ${threads} threads`, async t => {
    const native = await app(t, computeCodec, 'compute', { profile: threads === 1 ? 'native-cpu' : 'multithreaded-cpu', threads });
    const command: Command = c => native.command(c);
    assert.deepEqual(await command({ kind: 'threads' }), { kind: 'threads', value: threads });
    await command({ kind: 'advance', steps: 7 });
    for (const count of [0, 1, 31, 32, 33, 127, 511, 512]) {
      const captured = await command({ kind: 'samples', count });
      if (captured.kind !== 'snapshot') throw new Error('expected snapshot');
      assert.equal(captured.total, count);
      const actual = await reassemble(command, captured, 32);
      assert.equal(actual.length, count);
      actual.forEach((bits, i) => assert.ok(Math.abs(f32FromBits(bits) - (((i + 7) % 32) / 16 - 1)) <= 1e-7));
      if (count === 512) { await command({ kind: 'advance', steps: 1 }); await command({ kind: 'reset' }); }
      assert.deepEqual(await reassemble(command, captured, 17), actual);
      await command({ kind: 'release', snapshot: captured.snapshot });
    }
  });
}

test('compute raw native bounds reject malformed commands without state or snapshot mutation', async t => {
  const native = await app(t, computeCodec, 'compute');
  const requests = [Buffer.from([254]), Buffer.from([5, 0]), Buffer.from([7, 1, 2]), Buffer.from([7, 0, 0, 0, 0, 32, 2]),
    new BytesWriter().u8(4).u32(1025).toBuffer(), new BytesWriter().u8(8).u32(5).toBuffer(),
    new BytesWriter().u8(9).u32(513).toBuffer(), new BytesWriter().u8(8).u32(0xffffffff).toBuffer(),
    new BytesWriter().u8(10).u32(1).u32(0).u32(0).toBuffer(), new BytesWriter().u8(10).u32(1).u32(0).u32(33).toBuffer(),
    new BytesWriter().u8(10).u32(0).u32(0).u32(1).toBuffer(), Buffer.from([0, 33]), Buffer.from([3, 1, 0])];
  for (const raw of requests) {
    assert.deepEqual(await native.raw(raw), Buffer.from([255]));
    assert.deepEqual(await native.command({ kind: 'inspect' }), initial);
  }
  const captured = await native.command({ kind: 'samples', count: 33 });
  if (captured.kind !== 'snapshot') throw new Error('expected snapshot');
  const before = await native.command({ kind: 'page', snapshot: captured.snapshot, offset: 0, max: 32 });
  for (const raw of requests) assert.deepEqual(await native.raw(raw), Buffer.from([255]));
  assert.deepEqual(await native.command({ kind: 'page', snapshot: captured.snapshot, offset: 0, max: 32 }), before);
});
