import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { projectPath } from '../../src/paths.ts';
import { evaluateInventory, loadInventory, observedTestSchema, portableProfiles, type Inventory, type ObservedTest } from './inventory.ts';

export const completionModeSchema = z.enum(['portable', 'full']);
export type CompletionMode = z.infer<typeof completionModeSchema>;

export function evaluateCompletion(inventory: Inventory, observed: ObservedTest[], mode: CompletionMode) {
  const results = evaluateInventory(inventory, observed);
  const features = results.features.filter(row => row.status !== 'excluded' && (mode === 'full' || portableProfiles.includes(row.profile)));
  const profiles = results.profiles.filter(row => portableProfiles.includes(row.profile) || (mode === 'full' && row.profile === 'gpu'));
  const blockers = [
    ...features.filter(row => row.status !== 'verified').map(row => ({ id: row.id, status: row.status })),
    ...profiles.filter(row => row.status !== 'verified').map(row => ({ id: `profile.${row.profile}`, status: row.status })),
    ...observed.filter(test => test.status !== 'passed').map(test => ({ id: `${test.file}: ${test.name}`, status: test.status })),
  ];
  return { mode, completion: blockers.length ? 'in-progress' : `${mode}-complete`, blockers, ...results };
}

export function parseCompletionArgs(args: string[]) {
  if (args.length !== 2 && args.length !== 4) throw new Error('Usage: completion.ts --mode portable|full [--report path]');
  if (args[0] !== '--mode' || (args.length === 4 && args[2] !== '--report')) throw new Error('Usage: completion.ts --mode portable|full [--report path]');
  const mode = completionModeSchema.parse(args[1]);
  const report = args.length === 4 ? z.string().min(1).parse(args[3]) : 'build/phase2-results.json';
  return { mode, report };
}

export async function checkCompletion(args: string[]) {
  const { mode, report } = parseCompletionArgs(args);
  const inventory = await loadInventory();
  const input: unknown = JSON.parse(await readFile(projectPath(report), 'utf8'));
  const evidence = z.object({ version: z.literal(1), tests: z.array(observedTestSchema).min(1) }).parse(input);
  return evaluateCompletion(inventory, evidence.tests, mode);
}

if (import.meta.main) {
  try {
    const result = await checkCompletion(process.argv.slice(2));
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    if (result.blockers.length) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
