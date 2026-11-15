import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { bun, revision, run, source } from '../lib/toolchain.ts';
import { compilerCheckTargets } from './targets.ts';

assert.equal(run('git', ['rev-parse', 'HEAD'], source), revision, 'Run npm run setup:bend to pin the compiler');
for (const { input, gate } of compilerCheckTargets) {
  const output = run(bun, [resolve(source, 'bend2/main.ts'), input, gate]);
  assert.match(output, /ALL PROOFS CHECK/);
  process.stdout.write(`${input} ${gate}\n${output}\n`);
}
