import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test, { type TestContext } from 'node:test';
import { NativeApp } from '../../src/app.ts';
import { fileCodec } from '../../src/protocol/apps.ts';
import { assertGone, bounded } from '../helpers.ts';

const executable = resolve('build/file-worker');

async function app(t: TestContext) {
  const session = await NativeApp.start(fileCodec, { executable, callMs: 4000 });
  t.after(async () => { await bounded(session.close()); assertGone(session.pid); });
  return session;
}

async function scratch(t: TestContext): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'bendflow-file-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test('file workspace retains a handle across write, size, read, and close', async t => {
  const dir = await scratch(t);
  const path = join(dir, 'note.bin');
  const session = await app(t);
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
  const session = await app(t);
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
  const session = await app(t);
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
  const session = await app(t);
  const failed = await session.command({ kind: 'open', path, mode: 'x' });
  assert.equal(failed.kind, 'fail');
  const opened = await session.command({ kind: 'open', path, mode: 'r' });
  assert.equal(opened.kind, 'opened');
});
