import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { run, bun, source } from '../../../scripts/lib/toolchain.ts';
import { projectPath } from '../../../src/paths.ts';

export function networkFixture(name: 'cleanup' | 'uncertain' | 'exhaustion' | 'vectors'): string {
  const output = projectPath(`build/network-${name}-worker`);
  mkdirSync(projectPath('build'), { recursive: true });
  run(bun, [resolve(source, 'bend2/main.ts'), projectPath(`tests/fixtures/network/${name}-worker.bend`), '-o', output]);
  return output;
}
