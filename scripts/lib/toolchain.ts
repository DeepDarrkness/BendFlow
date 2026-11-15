import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { PROJECT_ROOT, projectPath } from '../../src/paths.ts';

export const revision = 'f0cf0a7c573145501981c44d9c33e326185f008e';
export const source = projectPath('.toolchain/bend');
export const bun = projectPath('node_modules/.bin/bun');
const localClang = projectPath('.toolchain/clang/usr/bin/clang-18');
const configuredClang = process.env.CC;
export const clang = configuredClang
  ? (isAbsolute(configuredClang) || !configuredClang.includes('/') ? configuredClang : projectPath(configuredClang))
  : existsSync(localClang) ? localClang : 'clang';
export const environment = {
  ...process.env, BEND_NO_TELEMETRY: '1', CC: clang,
  LD_LIBRARY_PATH: [projectPath('.toolchain/clang/usr/lib/x86_64-linux-gnu'), process.env.LD_LIBRARY_PATH].filter(Boolean).join(':'),
};

export function run(program: string, args: readonly string[], cwd = PROJECT_ROOT): string {
  try {
    return execFileSync(program, args, {
      cwd, env: environment, encoding: 'utf8', timeout: 120_000,
      maxBuffer: 8 * 1024 * 1024,
    }).trim();
  } catch (error) {
    throw new Error(`Required tool failed: ${program} ${args.join(' ')}. Install prerequisites; see README.md.`, { cause: error });
  }
}
