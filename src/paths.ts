import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const PROJECT_ROOT = fileURLToPath(new URL('../', import.meta.url));

export function projectPath(...parts: string[]): string {
  return resolve(PROJECT_ROOT, ...parts);
}
