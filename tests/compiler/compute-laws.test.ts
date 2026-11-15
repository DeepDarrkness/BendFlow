import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { bun, environment, source, revision } from '../../scripts/lib/toolchain.ts';
import { projectPath } from '../../src/paths.ts';
import { check } from '../support/compiler.ts';
import { external } from '../support/subprocess.ts';
import { scratch } from '../support/resources.ts';

test('compute pure core generic multiset order budget and simulation laws pass the BendTT kernel', async t => {
  const dir = await scratch(t, 'bendflow-compute-laws-');
  const result = await external(bun, [resolve(source, 'bend2/main.ts'), projectPath('bend/compute-proof.bend'), '--verdict'], {
    env: environment, timeout: 120000, maxBuffer: 8 * 1024 * 1024,
  });
  assert.match(result.stdout, /ALL PROOFS CHECK/);
  assert.doesNotMatch(result.stdout + result.stderr, /SOME PROOFS FAIL|infrastructure|TODO|unfinished/i);
  await external(bun, [resolve(source, 'bend2/main.ts'), projectPath('bend/compute-proof.bend'), '-o', join(dir, 'compute-proof.bendtt')], { env: environment, timeout: 120000 });
  const kernel = await readFile(join(dir, 'compute-proof.bendtt'), 'utf8');
  for (const law of ['sort_preservation', 'sort_order', 'sort_input_preservation', 'sort_input_order', 'tree_preservation', 'bounded_plan', 'plan_admission', 'advance_velocity', 'advance_flags', 'reset_initial', 'reset_idempotent', 'advance_zero', 'paused_stable', 'closed_stable', 'close_idempotent']) assert.ok(kernel.includes(law.replaceAll('_', '__')), `kernel translation missing ${law}`);
  const pinned = await external('git', ['-C', source, 'rev-parse', 'HEAD']);
  assert.equal(pinned.stdout.trim(), revision);
});

test('compute laws reject missing proofs and a false sort claim for the intended reasons', async () => {
  await assert.rejects(check('tests/fixtures/phase2/compute-open-proof.bend'), error => {
    assert.ok(error instanceof Error && 'stderr' in error && 'code' in error);
    assert.equal(error.code, 1);
    assert.match(String(error.stderr), /SOME PROOFS FAIL/);
    assert.match(String(error.stderr), /TODOs found|incomplete/);
    assert.doesNotMatch(String(error.stderr), /parse error|not found|undefined name/i);
    return true;
  });
  await assert.rejects(check('tests/fixtures/phase2/compute-false-proof.bend'), error => {
    assert.ok(error instanceof Error && 'stderr' in error && 'code' in error);
    assert.equal(error.code, 1);
    assert.match(String(error.stderr), /expected|observed/);
    assert.doesNotMatch(String(error.stderr), /parse error|not found|undefined name/i);
    return true;
  });
});

test('compute token exhaustion preserves state and returns a bounded error', async () => {
  const result = await external(bun, [resolve(source, 'bend2/main.ts'), projectPath('tests/fixtures/phase2/compute-exhaustion.bend')], { env: environment });
  assert.match(result.stdout, /4294967295/);
  assert.match(result.stdout, /\[8, 3\]/);
  assert.doesNotMatch(result.stdout, /SOME PROOFS FAIL/);
});
