import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PROJECT_ROOT, projectPath } from '../../src/paths.ts';
import { environment } from '../lib/toolchain.ts';

export type RuntimeSuite = 'unit' | 'integration' | 'compiler';
export type TestSelection = RuntimeSuite | 'types' | 'full';

export function discoverTests(suite: RuntimeSuite): string[] {
  function discover(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        return ['helpers', 'support', 'types', 'fixtures'].includes(entry.name) ? [] : discover(path);
      }
      return entry.isFile() && entry.name.endsWith('.test.ts') ? [path] : [];
    });
  }
  const files = discover(projectPath('tests', suite)).sort();
  if (!files.length) throw new Error(`No tests discovered in tests/${suite}`);
  return files;
}

export function runtimeTestArgs(selection: RuntimeSuite | 'full'): string[] {
  const suites: RuntimeSuite[] = selection === 'full' ? ['unit', 'integration', 'compiler'] : [selection];
  const args = ['--test', '--test-timeout=120000', '--test-reporter=spec'];
  // Native lifecycle/signal tests and compiler processes need predictable resource access.
  // The standalone pure unit suite can use Node's default parallelism.
  if (selection !== 'unit') args.push('--test-concurrency=1');
  if (selection === 'full') {
    args.push(
      `--test-reporter=${projectPath('scripts/conformance/reporter.ts')}`,
      '--test-reporter-destination=stdout',
      `--test-reporter-destination=${projectPath('build/phase2-results.json')}`,
    );
  }
  return [...args, ...suites.flatMap(discoverTests)];
}

function execute(args: string[]): void {
  const result = spawnSync(process.execPath, args, { cwd: PROJECT_ROOT, env: environment, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

export function runTests(selection: TestSelection): void {
  assert.equal(process.versions.node.split('.')[0], '24', 'Node 24 LTS is required');
  if (selection === 'types' || selection === 'full') {
    execute([projectPath('node_modules/typescript/bin/tsc'), '--noEmit', '--project', projectPath('tsconfig.json')]);
  }
  if (selection === 'types') return;
  const args = runtimeTestArgs(selection);
  if (selection === 'integration' || selection === 'full') execute([projectPath('scripts/build/native.ts')]);
  execute(args);
}

if (import.meta.main) {
  const selection = process.argv[2] ?? 'full';
  switch (selection) {
    case 'unit': case 'integration': case 'compiler': case 'types': case 'full':
      runTests(selection);
      break;
    default:
      throw new Error(`Unknown test suite: ${selection}. Expected unit, integration, compiler, types, or full.`);
  }
}
