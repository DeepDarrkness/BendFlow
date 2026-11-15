import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { projectPath } from '../../src/paths.ts';
import { loadInventory, evaluateInventory, normalizeTestFile, type ObservedTest } from './inventory.ts';
import { evaluateCompletion } from './completion.ts';

const testResult = z.object({
  name: z.string(), file: z.string(),
  skip: z.union([z.boolean(), z.string()]).optional(),
  todo: z.union([z.boolean(), z.string()]).optional(),
  details: z.object({ type: z.string() }).optional(),
});

export default async function* reporter(source: AsyncIterable<{ type: string; data: unknown }>) {
  const tests: ObservedTest[] = [];
  for await (const event of source) {
    if (event.type !== 'test:pass' && event.type !== 'test:fail') continue;
    const data = testResult.safeParse(event.data);
    if (!data.success || data.data.details?.type === 'suite') continue;
    tests.push({
      file: normalizeTestFile(data.data.file), name: data.data.name,
      status: (data.data.skip !== undefined && data.data.skip !== false) || (data.data.todo !== undefined && data.data.todo !== false)
        ? 'skipped' : event.type === 'test:pass' ? 'passed' : 'failed',
    });
  }
  const inventory = await loadInventory();
  const results = evaluateInventory(inventory, tests);
  const failed = tests.some(test => test.status === 'failed') || [...results.features, ...results.profiles].some(row => row.status === 'failed');
  const portable = evaluateCompletion(inventory, tests, 'portable');
  const full = evaluateCompletion(inventory, tests, 'full');
  const toolchain: unknown = JSON.parse(await readFile(projectPath('build/toolchain.json'), 'utf8'));
  yield JSON.stringify({
    version: 1, toolchain, completion: failed ? 'failed' : full.blockers.length === 0 ? 'full-complete' : portable.completion,
    completionPolicy: { portable: portable.completion, full: full.completion, excluded: ['hardware.window', 'hardware.audio'] },
    ...results, tests,
  }, null, 2) + '\n';
  if (failed) throw new Error('Test or conformance verification failed; see build/phase2-results.json');
}
