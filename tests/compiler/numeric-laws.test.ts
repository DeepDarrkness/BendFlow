import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { bun, environment, source } from '../../scripts/lib/toolchain.ts';
import { projectPath } from '../../src/paths.ts';
import { check } from '../support/compiler.ts';
import { scratch } from '../support/resources.ts';
import { external } from '../support/subprocess.ts';

test('numeric production pure core state bounds and transition laws pass the BendTT kernel', async t => {
  const dir = await scratch(t, 'bendflow-numeric-laws-');
  const proof = projectPath('bend/numeric-proof.bend');
  const result = await external(bun, [resolve(source, 'bend2/main.ts'), proof, '--verdict'], {
    env: environment, timeout: 120000, maxBuffer: 8 * 1024 * 1024,
  });
  assert.match(result.stdout, /ALL PROOFS CHECK/);
  assert.doesNotMatch(result.stdout + result.stderr, /SOME PROOFS FAIL|infrastructure|TODO|unfinished/i);
  const translation = join(dir, 'numeric-proof.bendtt');
  await external(bun, [resolve(source, 'bend2/main.ts'), proof, '-o', translation], { env: environment, timeout: 120000 });
  const kernel = await readFile(translation, 'utf8');
  for (const law of ['initial_bounds', 'add_preserves_bounds', 'guard_admission', 'rejection_preserves_state',
    'acceptance_accumulates', 'add_untouched_fields', 'reset_initial', 'reset_idempotent', 'word_state_bounds',
    'count_exhaustion_rejects']) {
    assert.ok(kernel.includes(law.replaceAll('_', '__')), `kernel translation missing ${law}`);
  }
});

test('numeric missing and false state laws fail for the intended proof diagnostics', async () => {
  for (const [fixture, diagnostic] of [
    ['numeric-open-proof.bend', /TODOs found|incomplete/],
    ['numeric-false-proof.bend', /expected|observed/],
  ] satisfies [string, RegExp][]) {
    await assert.rejects(check(`tests/fixtures/phase2/${fixture}`), error => {
      assert.ok(error instanceof Error && 'stderr' in error && 'code' in error);
      assert.equal(error.code, 1);
      assert.match(String(error.stderr), /SOME PROOFS FAIL/);
      assert.match(String(error.stderr), diagnostic);
      assert.doesNotMatch(String(error.stderr), /parse error|not found|undefined name/i);
      return true;
    });
  }
});

test('numeric production Add rejects exhausted count even for zero amount and preserves all fields on CPU', async t => {
  const dir = await scratch(t, 'bendflow-numeric-count-');
  const executable = join(dir, 'numeric-count-exhaustion');
  await external(bun, [resolve(source, 'bend2/main.ts'),
    projectPath('tests/fixtures/phase2/numeric-count-exhaustion.bend'), '-o', executable], {
    env: environment, timeout: 120000,
  });
  const result = await external(executable, ['+RTS', '--gpu', 'off', '--threads', '1'], { env: environment });
  assert.equal(result.stdout.trim(), '(../../../bend/numeric.Numeric{7n, 3, 4294967295, 9}, [1, 0, 0, 0, 0, 0, 7, 0, 0, 0, 3, 255, 255, 255, 255, 0, 0, 0, 9])');
});
