import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { bun, clang, revision, run, source } from '../lib/toolchain.ts';
import { CPU_ARGS } from '../../src/runtime.ts';
import { projectPath } from '../../src/paths.ts';
import { nativeTargets } from './targets.ts';

assert.equal(process.versions.node.split('.')[0], '24', 'Node 24 LTS is required');
assert.equal(run('git', ['rev-parse', 'HEAD'], source), revision, 'Run npm run setup:bend to pin the compiler');
assert.equal(run('git', ['status', '--porcelain', '--untracked-files=all'], source), '', 'Bend checkout must be clean for a reproducible build');
const clangVersion = run(clang, ['--version']);
assert.match(clangVersion, /clang version (1[4-9]|[2-9][0-9])\./, 'Clang >=14 is required');
const versions = {
  node: process.version, bun: run(bun, ['--version']),
  bend: run(bun, [resolve(source, 'bend2/main.ts'), 'version']),
  revision, clang: clangVersion.split('\n')[0],
  runtimeArgs: CPU_ARGS,
};
mkdirSync(projectPath('build'), { recursive: true });
for (const { input, output, checkOnly } of nativeTargets) {
  if (checkOnly) {
    process.stdout.write(run(bun, [resolve(source, 'bend2/main.ts'), input, '--check-only']) + '\n');
  }
  process.stdout.write(run(bun, [resolve(source, 'bend2/main.ts'), input, '-o', output]) + '\n');
}
assert.equal(run(projectPath('build/minimal'), versions.runtimeArgs), 'BendRT ready: 12');
writeFileSync(projectPath('build/toolchain.json'), JSON.stringify(versions, null, 2) + '\n');
process.stdout.write(JSON.stringify(versions, null, 2) + '\n');
