import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { bun, clang, revision, run, source } from './toolchain.ts';
import { CPU_ARGS } from '../src/runtime.ts';
import { SESSION_KINDS } from '../src/kinds.ts';

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
mkdirSync('build', { recursive: true });
for (const [input, output] of [
  ['tests/fixtures/minimal.bend', 'minimal'], ['bend/echo-worker.bend', 'echo-worker'],
  ['bend/session-worker.bend', 'session-worker'],
  ['tests/fixtures/session-cases.bend', 'session-cases'],
  ['tests/fixtures/phase2/bytes-check.bend', 'bytes-check'],
  ...SESSION_KINDS.map(kind => [`bend/${kind}-worker.bend`, `${kind}-worker`]),
]) {
  if (!input || !output) throw new Error('Invalid build target');
  if (output !== 'custom-worker') {
    process.stdout.write(run(bun, [resolve(source, 'bend2/main.ts'), input, '--check-only']) + '\n');
  }
  process.stdout.write(run(bun, [resolve(source, 'bend2/main.ts'), input, '-o', resolve('build', output)]) + '\n');
}
assert.equal(run(resolve('build/minimal'), versions.runtimeArgs), 'BendRT ready: 12');
writeFileSync('build/toolchain.json', JSON.stringify(versions, null, 2) + '\n');
process.stdout.write(JSON.stringify(versions, null, 2) + '\n');
