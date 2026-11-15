import { resolve } from 'node:path';
import { bun, environment, source } from '../../scripts/lib/toolchain.ts';
import { projectPath } from '../../src/paths.ts';
import { external } from './subprocess.ts';

export function check(file: string, timeout = 30_000) {
  return external(bun, [resolve(source, 'bend2/main.ts'), projectPath(file), '--check-only'], { env: environment, timeout });
}
