import { readFile } from 'node:fs/promises';
import { relative } from 'node:path';
import { z } from 'zod';
import { loadInventory, evaluateInventory, type ObservedTest } from './conformance.ts';

const testResult = z.object({ name: z.string(), file: z.string(), skip: z.union([z.boolean(), z.string()]).optional() });

export default async function* reporter(source: AsyncIterable<{ type: string; data: unknown }>) {
  const tests: ObservedTest[] = [];
  for await (const event of source) {
    if (event.type !== 'test:pass' && event.type !== 'test:fail') continue;
    const data = testResult.safeParse(event.data);
    if (!data.success) continue;
    tests.push({
      file: relative(process.cwd(), data.data.file), name: data.data.name,
      status: data.data.skip ? 'skipped' : event.type === 'test:pass' ? 'passed' : 'failed',
    });
  }
  const inventory = await loadInventory();
  const results = evaluateInventory(inventory, tests);
  const failed = [...results.features, ...results.profiles].some(row => row.status === 'failed');
  const complete = results.features.every(row => row.status === 'verified' || row.status === 'unavailable');
  const toolchain: unknown = JSON.parse(await readFile('build/toolchain.json', 'utf8'));
  yield JSON.stringify({
    version: 1, toolchain, completion: failed ? 'failed' : complete ? 'portable-complete' : 'in-progress',
    ...results, tests,
  }, null, 2) + '\n';
  if (failed) throw new Error('Verified conformance claim lacks an executed passing test; see build/phase2-results.json');
}
