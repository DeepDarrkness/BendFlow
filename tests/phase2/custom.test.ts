import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test, { type TestContext } from 'node:test';
import { NativeApp } from '../../src/app.ts';
import { customCodec } from '../../src/protocol/apps.ts';
import { assertGone, bounded } from '../helpers.ts';

const executable = resolve('build/custom-worker');

test('custom C effect writes an externally observed marker file', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'bendflow-custom-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'stamp.txt');
  const session = await NativeApp.start(customCodec, { executable, callMs: 4000 });
  t.after(async () => { await bounded(session.close()); assertGone(session.pid); });
  assert.deepEqual(await session.command({ kind: 'mark', path }), { kind: 'marked', value: 7 });
  assert.equal(await readFile(path, 'utf8'), 'custom\n');
});
