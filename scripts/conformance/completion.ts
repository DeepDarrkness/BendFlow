import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { projectPath } from '../../src/paths.ts';
import { evaluateInventory, loadInventory, observedTestSchema, portableProfiles, type Inventory, type ObservedTest } from './inventory.ts';
import { readHardware, type HardwareResult } from './hardware.ts';

export const completionModeSchema = z.enum(['portable', 'full']);
export type CompletionMode = z.infer<typeof completionModeSchema>;

export function evaluateCompletion(inventory: Inventory, observed: ObservedTest[], mode: CompletionMode, hardware?: HardwareResult) {
  const results = evaluateInventory(inventory, observed);
  const features = results.features.filter(row => row.status !== 'excluded' && (mode === 'full' || portableProfiles.includes(row.profile)));
  const profiles = results.profiles.filter(row => portableProfiles.includes(row.profile) || (mode === 'full' && row.profile === 'gpu'));
  const inventoryBlockers = [
    ...features.filter(row => row.status !== 'verified').map(row => ({ id: row.id, status: row.status })),
    ...profiles.filter(row => row.status !== 'verified').map(row => ({ id: `profile.${row.profile}`, status: row.status })),
    ...observed.filter(test => test.status !== 'passed').map(test => ({ id: `${test.file}: ${test.name}`, status: test.status })),
  ];
  // Standalone hardware can satisfy the GPU requirement without rewriting inventory.
  // Failed inventory verification (missing or failed referenced tests) still blocks.
  const blockers = inventoryBlockers.filter(row => !(mode === 'full' && hardware?.status === 'verified'
    && row.status !== 'failed' && (row.id === 'hardware.gpu' || row.id === 'profile.gpu')));
  if (mode === 'full' && hardware?.status !== 'verified') {
    blockers.push({ id: 'hardware.report.gpu', status: hardware?.status ?? 'unavailable' });
  }
  return { mode, completion: blockers.length ? 'in-progress' : `${mode}-complete`, blockers, ...results,
    ...(mode === 'full' ? { hardware: hardware ?? { status: 'unavailable', reason: 'No current GPU hardware evidence supplied' } } : {}) };
}

export function parseCompletionArgs(args: string[]) {
  const usage = 'Usage: completion.ts --mode portable|full [--report path] [--hardware-report path]';
  if (args[0] !== '--mode' || ![2, 4, 6].includes(args.length)) throw new Error(usage);
  const mode = completionModeSchema.parse(args[1]);
  let report = 'build/phase2-results.json';
  let hardwareReport: string | undefined;
  const seen = new Set<string>();
  for (let i = 2; i < args.length; i += 2) {
    const flag = args[i];
    if (!flag || seen.has(flag) || (flag !== '--report' && flag !== '--hardware-report')) throw new Error(usage);
    seen.add(flag);
    const path = z.string().min(1).parse(args[i + 1]);
    if (flag === '--report') report = path;
    else hardwareReport = path;
  }
  return { mode, report, ...(hardwareReport ? { hardwareReport } : {}) };
}

export async function checkCompletion(args: string[]) {
  const { mode, report, hardwareReport } = parseCompletionArgs(args);
  const inventory = await loadInventory();
  const input: unknown = JSON.parse(await readFile(projectPath(report), 'utf8'));
  const evidence = z.object({ version: z.literal(1), tests: z.array(observedTestSchema).min(1) }).parse(input);
  return evaluateCompletion(inventory, evidence.tests, mode, mode === 'full' ? readHardware(hardwareReport ? projectPath(hardwareReport) : undefined) : undefined);
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
