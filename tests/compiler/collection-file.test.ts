import assert from 'node:assert/strict';
import test from 'node:test';
import { check } from '../support/compiler.ts';
import { run, bun, source } from '../../scripts/lib/toolchain.ts';
import { projectPath } from '../../src/paths.ts';
import { CPU_ARGS } from '../../src/runtime.ts';

test('collection-file positive affine template polymorphic and sized fixtures check and execute',async()=>{
  const result=await check('tests/fixtures/collection-file/positive.bend');assert.match(result.stdout,/ALL PROOFS CHECK/);
  assert.equal(run(bun,[source+'/bend2/main.ts','tests/fixtures/collection-file/positive.bend']),'[42, 42, 42, 42, 42]');
  run(bun,[source+'/bend2/main.ts','tests/fixtures/collection-file/native-positive.bend','-o',projectPath('build/collection-file-fixtures')]);
  assert.equal(run(projectPath('build/collection-file-fixtures'),CPU_ARGS),'42 42 42 42 42 \n0 4294967295 42 11');
});

for(const [file,diagnostic] of [
  ['duplicate-array',/array \(consumed more than once\)/],['duplicate-file',/file \(consumed more than once\)/],
  ['duplicate-closure',/closure \(consumed more than once\)/],['local-template',/expected : a template applied to closed ~ arguments/],
  ['invalid-sized',/expected : Sigma<&1, &1, U32, _ => Unit>\s*- observed : Unit/],
] satisfies [string,RegExp][]){
  test(`collection-file compiler rejects ${file} for its intended diagnostic`,async()=>{
    await assert.rejects(check(`tests/fixtures/collection-file/${file}.bend`),error=>{
      assert.ok(error instanceof Error&&'stderr'in error&&'code'in error);assert.equal(error.code,1);
      const stderr=String(error.stderr);assert.match(stderr,diagnostic);assert.doesNotMatch(stderr,/parse error|a defined name|file not found|Cannot resolve/i);return true;
    });
  });
}

test('collection-file snapshot U32 exhaustion retains the last token without wrap replacement',async()=>{
  const result=await check('tests/fixtures/collection-file/snapshot-exhaustion.bend');assert.match(result.stdout,/ALL PROOFS CHECK/);
  assert.equal(run(bun,[source+'/bend2/main.ts','tests/fixtures/collection-file/snapshot-exhaustion.bend']),'[0, 4294967295, 42, 11]');
});
