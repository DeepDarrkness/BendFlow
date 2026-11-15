import assert from 'node:assert/strict';
import test from 'node:test';
import { CPU_ARGS } from '../../src/runtime.ts';
import { projectPath } from '../../src/paths.ts';
import { external } from '../support/subprocess.ts';

test('compiled bytes codec decodes native nat and text values and rejects invalid UTF-8', async () => {
  const result = await external(projectPath('build/bytes-check'), CPU_ARGS, { timeout: 5000 });
  assert.equal(result.stderr, '');
  assert.deepEqual(result.stdout.trim().split('\n'), ['nat:65535', 'text:Ae', 'none']);
});
