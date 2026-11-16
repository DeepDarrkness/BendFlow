import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { z } from 'zod';
import { environment, revision, run, source } from '../lib/toolchain.ts';
import { projectPath } from '../../src/paths.ts';

const record = z.strictObject({ type: z.string(), constructor: z.string(), fields: z.array(z.string()).min(1).max(61) });
const descriptionSchema = z.strictObject({
  services: z.array(z.strictObject({ name: z.string(), state: z.string(), stateCode: z.string(), initialize: z.string(), transition: z.string(),
    finalize: z.string(), parameter: z.string(), request: record, response: record })).min(1),
  sources: z.array(z.string()).min(1),
});
export type ServiceDescription = z.infer<typeof descriptionSchema>['services'][number];

export function inspectServices(entry: string) {
  if (run('git', ['rev-parse', 'HEAD'], source) !== revision || run('git', ['status', '--porcelain', '--untracked-files=all'], source)) {
    throw new Error('Service generation requires the clean pinned Bend compiler. Run npm run setup:bend.');
  }
  const result = spawnSync(process.execPath, [projectPath('scripts/services/compiler.mjs'), resolve(source, 'bend2/bend.ts'), resolve(entry)], {
    env: environment, encoding: 'utf8', timeout: 30_000, maxBuffer: 2 * 1024 * 1024,
  });
  if (result.error) throw new Error('Service extraction failed or exceeded its deadline', { cause: result.error });
  if (result.status !== 0) throw new Error(result.stderr.trim() || 'Service extraction failed');
  return descriptionSchema.parse(JSON.parse(result.stdout));
}
