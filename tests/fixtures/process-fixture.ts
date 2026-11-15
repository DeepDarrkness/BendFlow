import type { TestContext } from 'node:test';
import { join } from 'node:path';
import { clang } from '../../scripts/lib/toolchain.ts';
import { projectPath } from '../../src/paths.ts';
import { external } from '../support/subprocess.ts';
import { scratch } from '../support/resources.ts';

export async function processFixture(t: TestContext) {
  const dir = await scratch(t, 'bf-proc-');
  const executable = join(dir, 'fixture');
  const marker = join(dir, 'observed');
  await external(clang, [projectPath('tests/fixtures/phase2/process-fixture.c'), '-O2', '-o', executable]);
  return { executable, marker, env: { BENDFLOW_PROCESS_FIXTURE: executable, BENDFLOW_PROCESS_MARKER: marker } };
}
