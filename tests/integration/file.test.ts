import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { app } from '../support/native.ts';
import { fileCodec } from '../../src/protocol/apps.ts';
import { BytesWriter } from '../../src/protocol/bytes.ts';
import { scratch } from '../support/resources.ts';

test('file workspace retains a handle across write, size, read, and close', async t => {
  const dir = await scratch(t);
  const path = join(dir, 'note.bin');
  const session = await app(t, fileCodec, 'file', { callMs: 4000 });
  const opened = await session.command({ kind: 'open', path, mode: 'w' });
  assert.equal(opened.kind, 'opened');
  if (opened.kind !== 'opened') throw new Error('expected opened');
  assert.deepEqual(await session.command({ kind: 'write', id: opened.id, bytes: Buffer.from('hi') }), { kind: 'ok' });
  assert.deepEqual(await session.command({ kind: 'size', id: opened.id }), { kind: 'size', value: 2 });
  assert.deepEqual(await session.command({ kind: 'close', id: opened.id }), { kind: 'ok' });
  assert.equal(await readFile(path, 'utf8'), 'hi');
  const reading = await session.command({ kind: 'open', path, mode: 'r' });
  assert.equal(reading.kind, 'opened');
  if (reading.kind !== 'opened') throw new Error('expected opened');
  const got = await session.command({ kind: 'read', id: reading.id, max: 8 });
  assert.equal(got.kind, 'bytes');
  if (got.kind !== 'bytes') throw new Error('expected bytes');
  assert.equal(Buffer.from(got.bytes).toString('utf8'), 'hi');
  await session.command({ kind: 'close', id: reading.id });
  assert.deepEqual(await session.command({ kind: 'size', id: reading.id }), { kind: 'missing' });
});

test('failed file read keeps the handle for a later write', async t => {
  const dir = await scratch(t);
  const path = join(dir, 'keep.bin');
  const session = await app(t, fileCodec, 'file', { callMs: 4000 });
  const opened = await session.command({ kind: 'open', path, mode: 'w' });
  assert.equal(opened.kind, 'opened');
  if (opened.kind !== 'opened') throw new Error('expected opened');
  const failed = await session.command({ kind: 'read', id: opened.id, max: 8 });
  assert.equal(failed.kind, 'fail');
  assert.deepEqual(await session.command({ kind: 'write', id: opened.id, bytes: Buffer.from('kept') }), { kind: 'ok' });
  await session.command({ kind: 'close', id: opened.id });
  assert.equal(await readFile(path, 'utf8'), 'kept');
});

test('file offset write and read are visible on disk', async t => {
  const dir = await scratch(t);
  const path = join(dir, 'offset.bin');
  const session = await app(t, fileCodec, 'file', { callMs: 4000 });
  const created = await session.command({ kind: 'open', path, mode: 'w' });
  assert.equal(created.kind, 'opened');
  if (created.kind !== 'opened') throw new Error('expected opened');
  assert.deepEqual(await session.command({ kind: 'write', id: created.id, bytes: Buffer.from('abcd') }), { kind: 'ok' });
  await session.command({ kind: 'close', id: created.id });
  const opened = await session.command({ kind: 'open', path, mode: 'r+' });
  assert.equal(opened.kind, 'opened');
  if (opened.kind !== 'opened') throw new Error('expected opened');
  assert.deepEqual(await session.command({ kind: 'writeAt', id: opened.id, offset: 1, bytes: Buffer.from('XY') }), { kind: 'ok' });
  const got = await session.command({ kind: 'readAt', id: opened.id, offset: 0, max: 8 });
  assert.equal(got.kind, 'bytes');
  if (got.kind !== 'bytes') throw new Error('expected bytes');
  assert.equal(Buffer.from(got.bytes).toString('utf8'), 'aXYd');
  await session.command({ kind: 'close', id: opened.id });
  assert.equal(await readFile(path, 'utf8'), 'aXYd');
});

test('exclusive create fails when the path exists and later commands still work', async t => {
  const dir = await scratch(t);
  const path = join(dir, 'exists.bin');
  await writeFile(path, 'old');
  const session = await app(t, fileCodec, 'file', { callMs: 4000 });
  const failed = await session.command({ kind: 'open', path, mode: 'x' });
  assert.equal(failed.kind, 'fail');
  const opened = await session.command({ kind: 'open', path, mode: 'r' });
  assert.equal(opened.kind, 'opened');
});

test('raw oversized file reads are rejected before advancing the retained handle', async t => {
  const dir = await scratch(t);
  const path = join(dir, 'bounded.bin');
  await writeFile(path, Buffer.alloc(200, 7));
  const session = await app(t, fileCodec, 'file', { callMs: 4000 });
  const opened = await session.command({ kind: 'open', path, mode: 'r' });
  if (opened.kind !== 'opened') throw new Error('expected opened');
  const reads = [
    new BytesWriter().u8(2).u32(opened.id).u32(193).toBuffer(),
    new BytesWriter().u8(4).u32(opened.id).u32(0).u32(193).toBuffer(),
  ];
  for (const raw of reads) assert.deepEqual(fileCodec.decode(await session.raw(raw)), { kind: 'invalidCommand' });
  const first = await session.command({ kind: 'read', id: opened.id, max: 192 });
  if (first.kind !== 'bytes') throw new Error('expected bytes');
  assert.deepEqual(first.bytes, Buffer.alloc(192, 7));
  const last = await session.command({ kind: 'read', id: opened.id, max: 192 });
  if (last.kind !== 'bytes') throw new Error('expected bytes');
  assert.deepEqual(last.bytes, Buffer.alloc(8, 7));
});
