import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export const revision = 'f0cf0a7c573145501981c44d9c33e326185f008e';
export const source = resolve('.toolchain/bend');
export const bun = resolve('node_modules/.bin/bun');
const localClang = resolve('.toolchain/clang/usr/bin/clang-18');
export const clang = process.env.CC ?? (existsSync(localClang) ? localClang : 'clang');
export const environment = {
  ...process.env, BEND_NO_TELEMETRY: '1', CC: clang,
  LD_LIBRARY_PATH: [resolve('.toolchain/clang/usr/lib/x86_64-linux-gnu'), process.env.LD_LIBRARY_PATH].filter(Boolean).join(':'),
};

export function run(program: string, args: string[], cwd = process.cwd()): string {
  try {
    return execFileSync(program, args, {
      cwd, env: environment, encoding: 'utf8', timeout: 120_000,
      maxBuffer: 8 * 1024 * 1024,
    }).trim();
  } catch (error) {
    throw new Error(`Required tool failed: ${program} ${args.join(' ')}. Install prerequisites; see README.md.`, { cause: error });
  }
}
