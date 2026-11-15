import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { app } from '../support/native.ts';
import { customCodec } from '../../src/protocol/apps.ts';
import { scratch } from '../support/resources.ts';

test('custom C effect writes an externally observed marker file', async t => {
  const dir = await scratch(t, 'bendflow-custom-');
  const path = join(dir, 'stamp.txt');
  const session = await app(t, customCodec, 'custom', { callMs: 4000 });
  assert.deepEqual(await session.command({ kind: 'mark', path }), { kind: 'marked', value: 7 });
  assert.equal(await readFile(path, 'utf8'), 'custom\n');
});
