import assert from 'node:assert/strict';
import test from 'node:test';
import { check } from '../support/compiler.ts';

test('Bend checker rejects duplicating the affine session state', async () => {
  await assert.rejects(check('tests/fixtures/duplicate-session-state.bend', 10_000), error => {
    assert.ok(error instanceof Error && 'stderr' in error && 'code' in error);
    assert.equal(error.code, 1);
    assert.match(String(error.stderr), /state \(consumed more than once\)/);
    return true;
  });
});

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
