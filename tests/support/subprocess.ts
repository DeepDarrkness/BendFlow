import { execFile, type ExecFileOptions } from 'node:child_process';
import { promisify } from 'node:util';
import { PROJECT_ROOT } from '../../src/paths.ts';

const execute = promisify(execFile);
export function external(file: string, args: readonly string[], options: ExecFileOptions = {}) {
  return execute(file, args, {
    ...options, cwd: PROJECT_ROOT, encoding: 'utf8', timeout: options.timeout ?? 10_000,
    killSignal: 'SIGKILL', maxBuffer: options.maxBuffer ?? 16384,
  });
}
