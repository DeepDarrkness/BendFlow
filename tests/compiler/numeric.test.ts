import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { check } from '../support/compiler.ts';
import { external } from '../support/subprocess.ts';
import { bun, environment, source } from '../../scripts/lib/toolchain.ts';
import { projectPath } from '../../src/paths.ts';
import { CPU_ARGS } from '../../src/runtime.ts';

test('numeric affine state, erased parameters, and concrete polymorphism check and execute natively', async t => {
  const fixture = 'tests/fixtures/phase2/numeric-positive.bend';
  const checked = await check(fixture);
  assert.match(checked.stdout, /ALL PROOFS CHECK/);
  const directory = await mkdtemp(projectPath('build/numeric-compiler-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const executable = resolve(directory, 'numeric-positive');
  await external(bun, [resolve(source, 'bend2/main.ts'), projectPath(fixture), '-o', executable], { env: environment, timeout: 120_000 });
  const executed = await external(executable, CPU_ARGS, { env: environment });
  assert.equal(executed.stdout.trim(), '42\n4294967295');
});

test('numeric erased value cannot escape into live computation', async () => {
  await assert.rejects(check('tests/fixtures/phase2/numeric-erased-negative.bend'), error => {
    assert.ok(error instanceof Error && 'stderr' in error && 'code' in error);
    assert.equal(error.code, 1);
    assert.match(String(error.stderr), /expected : -value|erased/);
    return true;
  });
});

test('numeric concrete polymorphism rejects an argument of the wrong instantiated type', async () => {
  await assert.rejects(check('tests/fixtures/phase2/numeric-polymorphic-negative.bend'), error => {
    assert.ok(error instanceof Error && 'stderr' in error && 'code' in error);
    assert.equal(error.code, 1);
    assert.match(String(error.stderr), /expected : U32/);
    assert.match(String(error.stderr), /observed : Bool|observed : True/);
    return true;
  });
});
