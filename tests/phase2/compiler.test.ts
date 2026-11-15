import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import test from 'node:test';
import { bun, environment, source } from '../../scripts/toolchain.ts';

const execute = promisify(execFile);

async function check(file: string) {
  return execute(bun, [resolve(source, 'bend2/main.ts'), file, '--check-only'], { env: environment, timeout: 30_000 });
}

test('Bend checker rejects duplicating affine numeric state', async () => {
  await assert.rejects(check('tests/fixtures/phase2/duplicate-numeric-state.bend'), error => {
    assert.ok(error instanceof Error && 'stderr' in error && 'code' in error);
    assert.equal(error.code, 1);
    assert.match(String(error.stderr), /consumed more than once/);
    return true;
  });
});

test('Bend checker rejects matching a computed value', async () => {
  await assert.rejects(check('tests/fixtures/phase2/computed-match.bend'), error => {
    assert.ok(error instanceof Error && 'stderr' in error && 'code' in error);
    assert.equal(error.code, 1);
    assert.match(String(error.stderr), /computed value|scrutinee|can't be matched/);
    return true;
  });
});

test('Bend checker rejects a non-decreasing recursive call', async () => {
  await assert.rejects(check('tests/fixtures/phase2/non-decreasing.bend'), error => {
    assert.ok(error instanceof Error && 'stderr' in error && 'code' in error);
    assert.equal(error.code, 1);
    assert.match(String(error.stderr), /smaller than|non-decreasing|shrinks/);
    return true;
  });
});

test('Bend checker rejects using an erased binder', async () => {
  await assert.rejects(check('tests/fixtures/phase2/erased-binder.bend'), error => {
    assert.ok(error instanceof Error && 'stderr' in error && 'code' in error);
    assert.equal(error.code, 1);
    assert.match(String(error.stderr), /expected : -x|erased/);
    return true;
  });
});

test('bytes codec fixture still checks', async () => {
  const result = await check('tests/fixtures/phase2/bytes-check.bend');
  assert.match(result.stdout, /ALL PROOFS CHECK/);
});
