import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { app } from '../support/native.ts';
import { customCodec } from '../../src/protocol/apps.ts';
import { scratch } from '../support/resources.ts';
import type { CustomCommand, CustomReply, CustomOutcome } from '../../contracts/custom.ts';
import type { NativeApp } from '../../src/app.ts';
import { BytesWriter } from '../../src/protocol/bytes.ts';

async function history(session: NativeApp<CustomCommand, CustomReply>) {
  const results: CustomOutcome[] = [];
  let total = 0;
  do {
    const reply = await session.command({ kind: 'history', offset: results.length });
    assert.equal(reply.kind, 'history');
    if (reply.kind !== 'history') throw new Error('Expected history');
    assert.equal(reply.offset, results.length);
    total = reply.total;
    results.push(...reply.results);
  } while (results.length < total);
  return { kind: 'history', results };
}

test('custom C effect writes an externally observed marker file', async t => {
  const dir = await scratch(t, 'bendflow-custom-');
  const path = join(dir, 'stamp.txt');
  const session = await app(t, customCodec, 'custom', { callMs: 4000 });
  assert.deepEqual(await session.command({ kind: 'mark', path }), { kind: 'marked', value: 7 });
  assert.equal(await readFile(path, 'utf8'), 'custom\n');
});

test('custom execution paths return native constructors and complete helper-thread writes', async t => {
  const dir = await scratch(t, 'bf-custom-');
  const path = join(dir, 'output');
  const session = await app(t, customCodec, 'custom', { callMs: 4000 });
  const results: CustomOutcome[] = [];
  results.push({ kind: 'immediate', value: 0xffffffff });
  assert.deepEqual(await session.command({ kind: 'immediate', value: 0xffffffff }), results.at(-1));
  for (const text of ['é🙂\0\n'.repeat(18) + '12345', '', 'replacement\n']) {
    await writeFile(path, 'old trailing data'.repeat(30));
    const reply = { kind: 'written', value: Buffer.byteLength(text) } satisfies CustomOutcome;
    assert.deepEqual(await session.command({ kind: 'write', path, text }), reply);
    assert.deepEqual(await readFile(path), Buffer.from(text));
    results.push(reply);
  }
  const started = performance.now();
  assert.deepEqual(await session.command({ kind: 'parked', milliseconds: 50, value: 42 }), { kind: 'parked', value: 42 });
  assert.ok(performance.now() - started >= 40, 'parked result must not precede its timer');
  results.push({ kind: 'parked', value: 42 });
  assert.deepEqual(await session.command({ kind: 'parked', milliseconds: 0, value: 0 }), { kind: 'parked', value: 0 });
  results.push({ kind: 'parked', value: 0 });
  for (let i = 0; i < 3; i++) assert.deepEqual(await history(session), { kind: 'history', results });
});

test('custom failure-persistence retains failures followed by successes across repeated reads and isolated sessions', async t => {
  const dir = await scratch(t, 'bf-custom-');
  const session = await app(t, customCodec, 'custom');
  const other = await app(t, customCodec, 'custom');
  const results: CustomOutcome[] = [];
  for (let i = 0; i < 3; i++) {
    const failed = await session.command({ kind: 'write', path: join(dir, 'absent', 'file'), text: 'never' });
    assert.equal(failed.kind, 'fail');
    if (failed.kind !== 'fail') throw new Error('Expected native failure');
    assert.equal(failed.code, 2);
    assert.ok(failed.message.length > 0);
    results.push(failed);
    const path = join(dir, `success-${i}`);
    const reply = { kind: 'marked', value: 7 } satisfies CustomOutcome;
    assert.deepEqual(await session.command({ kind: 'mark', path }), reply);
    assert.equal(await readFile(path, 'utf8'), 'custom\n');
    results.push(reply);
    for (let j = 0; j < 2; j++) assert.deepEqual(await history(session), { kind: 'history', results });
    assert.deepEqual(await history(other), { kind: 'history', results: [] });
  }
  assert.deepEqual(await other.command({ kind: 'immediate', value: 9 }), { kind: 'immediate', value: 9 });
  assert.deepEqual(await history(session), { kind: 'history', results });
});

test('custom raw malformed commands perform no effects and do not alter retained results', async t => {
  const dir = await scratch(t, 'bf-custom-');
  const path = join(dir, 'forbidden');
  const session = await app(t, customCodec, 'custom');
  assert.deepEqual(await session.command({ kind: 'immediate', value: 5 }), { kind: 'immediate', value: 5 });
  const valid = customCodec.encode({ kind: 'write', path, text: 'data' });
  const malformed = [Buffer.alloc(0), Buffer.from([255]), Buffer.from([0, 0]), Buffer.from([0, 1, 0]),
    Buffer.from([0, 2, 0xc0, 0xaf]), Buffer.from([0, 1, 0xff]), Buffer.from([0, 97, ...Array(97).fill(97)]),
    new BytesWriter().u8(4).u32(10001).u32(1).toBuffer(), Buffer.from([3, 1, 97, 150, ...Array(150).fill(97)]),
    new BytesWriter().u8(5).u32(33).toBuffer(), Buffer.from([3, 0, 1, 97]), Buffer.from([3, 1, 97, 1, 255])];
  for (const command of [valid, customCodec.encode({ kind: 'mark', path }),
    customCodec.encode({ kind: 'immediate', value: 7 }), customCodec.encode({ kind: 'parked', milliseconds: 0, value: 7 }),
    customCodec.encode({ kind: 'history', offset: 0 })]) {
    for (let n = 0; n < command.length; n++) malformed.push(command.subarray(0, n));
    malformed.push(Buffer.concat([command, Buffer.from([0])]));
  }
  for (const payload of malformed) assert.deepEqual(await session.raw(payload), Buffer.from([255]), payload.toString('hex'));
  assert.deepEqual(await readdir(dir), []);
  assert.deepEqual(await history(session), { kind: 'history', results: [{ kind: 'immediate', value: 5 }] });
  assert.deepEqual(await session.command({ kind: 'history', offset: 2 }), { kind: 'fail', code: 22, message: 'custom history offset exceeds total' });
  assert.deepEqual(await history(session), { kind: 'history', results: [{ kind: 'immediate', value: 5 }] });
  assert.deepEqual(await session.command({ kind: 'mark', path }), { kind: 'marked', value: 7 });
  assert.equal(await readFile(path, 'utf8'), 'custom\n');
});

test('multithreaded CPU custom effects retain constructor results and recover after helper-thread failure', async t => {
  const dir = await scratch(t, 'bf-custom-');
  const session = await app(t, customCodec, 'custom', { profile: 'multithreaded-cpu', threads: 4 });
  const failed = await session.command({ kind: 'write', path: join(dir, 'missing', 'file'), text: 'never' });
  assert.equal(failed.kind, 'fail');
  if (failed.kind !== 'fail') throw new Error('Expected native failure');
  assert.equal(failed.code, 2);
  const path = join(dir, 'output');
  assert.deepEqual(await session.command({ kind: 'write', path, text: 'é🙂\0\n' }), { kind: 'written', value: 8 });
  assert.deepEqual(await readFile(path), Buffer.from('é🙂\0\n'));
  assert.deepEqual(await session.command({ kind: 'immediate', value: 12 }), { kind: 'immediate', value: 12 });
  assert.deepEqual(await session.command({ kind: 'parked', milliseconds: 5, value: 13 }), { kind: 'parked', value: 13 });
  for (let i = 0; i < 2; i++) assert.deepEqual(await history(session), {
    kind: 'history', results: [failed, { kind: 'written', value: 8 }, { kind: 'immediate', value: 12 }, { kind: 'parked', value: 13 }],
  });
});

test('custom native raw replies agree with golden vectors for constructors and history pages', async t => {
  const session = await app(t, customCodec, 'custom');
  assert.equal((await session.raw(Buffer.from('01ffffffff', 'hex'))).toString('hex'), '01ffffffff');
  assert.equal((await session.raw(Buffer.from('04000000000000002a', 'hex'))).toString('hex'), '040000002a');
  assert.equal((await session.raw(Buffer.from('0500000000', 'hex'))).toString('hex'), '0500000000000000020201ffffffff040000002a');
  assert.equal((await session.raw(Buffer.from('0500000001', 'hex'))).toString('hex'), '05000000010000000201040000002a');
  assert.equal((await session.raw(Buffer.from('0500000002', 'hex'))).toString('hex'), '05000000020000000200');
});

test('custom bounded full history reassembles complete results and rejects effects without eviction', async t => {
  const dir = await scratch(t, 'bf-custom-');
  const session = await app(t, customCodec, 'custom');
  const results: CustomOutcome[] = [];
  for (let i = 0; i < 32; i++) {
    const reply = await session.command({ kind: 'mark', path: dir });
    assert.equal(reply.kind, 'fail');
    if (reply.kind !== 'fail') throw new Error('Expected native failure');
    assert.equal(reply.code, 21);
    results.push(reply);
  }
  for (let i = 0; i < 3; i++) assert.deepEqual(await history(session), { kind: 'history', results });
  for (const command of [
    { kind: 'mark', path: join(dir, 'forbidden') },
    { kind: 'write', path: join(dir, 'forbidden'), text: 'never' },
    { kind: 'immediate', value: 1 },
    { kind: 'parked', milliseconds: 10000, value: 1 },
  ] satisfies Parameters<typeof session.command>[0][]) {
    assert.deepEqual(await session.command(command), { kind: 'fail', code: 75, message: 'custom history is full' });
  }
  assert.deepEqual(await readdir(dir), []);
  assert.deepEqual(await history(session), { kind: 'history', results });
  assert.deepEqual(await session.command({ kind: 'history', offset: 32 }), { kind: 'history', offset: 32, total: 32, results: [] });
});
