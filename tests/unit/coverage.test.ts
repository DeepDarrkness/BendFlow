import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadInventory, validateInventory, evaluateInventory, type Inventory, type ObservedTest } from '../../scripts/conformance/inventory.ts';
import { evaluateCompletion, parseCompletionArgs } from '../../scripts/conformance/completion.ts';
import { projectPath } from '../../src/paths.ts';

function passingReferences(inventory: Inventory): ObservedTest[] {
  return [...inventory.features, ...inventory.profiles].flatMap(row => row.status === 'verified'
    ? row.tests.map(ref => ({ ...ref, status: 'passed' })) : []);
}

async function controlledPortableInventory(): Promise<Inventory> {
  const inventory = await loadInventory();
  const fixture = { file: 'tests/unit/coverage.test.ts', name: 'controlled fixture evidence' };
  return validateInventory({ ...inventory, features: inventory.features.map(row => row.status === 'excluded' || row.id === 'hardware.gpu'
    ? row : { id: row.id, target: row.target, commands: row.commands, profile: row.profile, status: 'verified', tests: [fixture], evidence: 'Controlled test input, not implementation evidence' }) });
}

test('coverage inventory preserves required IDs and explicit native window and audio exclusions', async () => {
  const inventory = await loadInventory();
  for (const id of ['hardware.window', 'hardware.audio']) {
    assert.equal(inventory.features.find(row => row.id === id)?.status, 'excluded');
  }
  assert.equal(inventory.profiles.find(row => row.profile === 'graphics-audio')?.status, 'excluded');
});

test('coverage validation rejects duplicate IDs, missing commands, and nonexistent evidence files', async () => {
  const inventory = await loadInventory();
  await assert.rejects(validateInventory({ ...inventory, features: [...inventory.features, inventory.features[0]] }), /Duplicate feature ID/);
  await assert.rejects(validateInventory({ ...inventory, features: inventory.features.map(row => row.target === 'file' ? { ...row, commands: [] } : row) }), /Missing command coverage/);
  const verified = inventory.features.find(row => row.status === 'verified');
  if (!verified) throw new Error('Expected verified feature');
  await assert.rejects(validateInventory({ ...inventory, features: inventory.features.map(row => row.id === verified.id
    ? { ...row, tests: [{ file: 'tests/nonexistent.test.ts', name: 'missing' }] } : row) }), /ENOENT/);
});

test('coverage validation cannot claim verified GPU execution with an unavailable profile', async () => {
  const inventory = await loadInventory();
  const cpu = inventory.features.find(row => row.status === 'verified');
  if (!cpu) throw new Error('Expected verified feature');
  await assert.rejects(validateInventory({ ...inventory, features: inventory.features.map(row => row.id === cpu.id ? { ...row, profile: 'gpu' } : row) }), /requires a portable profile/);
  await assert.rejects(validateInventory({ ...inventory, features: inventory.features.map(row => row.id === 'hardware.gpu'
    ? { id: row.id, target: row.target, commands: row.commands, profile: row.profile, status: 'verified', tests: cpu.tests, evidence: cpu.evidence } : row) }), /requires a verified profile/);
  await assert.rejects(validateInventory({ ...inventory, profiles: inventory.profiles.map(row => row.profile === 'gpu'
    ? { profile: 'gpu', status: 'verified', tests: cpu.tests, evidence: 'CPU pixels alone' } : row) }), /requires CUDA device execution/);
});

test('coverage cannot become complete by deleting pending requirements', async () => {
  const inventory = await loadInventory();
  await assert.rejects(validateInventory({ ...inventory, features: inventory.features.filter(row => row.id !== 'protocol.paging') }), /Missing required feature/);
  await assert.rejects(validateInventory({ ...inventory, features: inventory.features.filter(row => row.id !== 'compiler.laws-verdict') }), /Missing required feature/);
});

test('conformance reporting requires an executed passing test rather than an evidence string', async () => {
  const inventory = await loadInventory();
  const row = inventory.features.find(row => row.id === 'file.persistence');
  if (!row || row.status !== 'verified') throw new Error('Expected file persistence feature');
  const ref = row.tests[0];
  if (!ref) throw new Error('Expected test reference');
  for (const status of ['failed', 'skipped'] as const) {
    const report = evaluateInventory(inventory, [...passingReferences(inventory), { ...ref, status }]);
    assert.equal(report.features.find(feature => feature.id === row.id)?.status, 'failed');
  }
  const report = evaluateInventory(inventory, passingReferences(inventory));
  assert.equal(report.features.find(feature => feature.id === row.id)?.status, 'verified');
  const missing = evaluateInventory(inventory, passingReferences(inventory).filter(test => test.name !== ref.name));
  assert.equal(missing.features.find(feature => feature.id === row.id)?.status, 'failed');
  const wrongName = evaluateInventory(inventory, [{ ...ref, name: `${ref.name} typo`, status: 'passed' }]);
  assert.equal(wrongName.features.find(feature => feature.id === row.id)?.status, 'failed');
});

test('controlled pending portable requirements block completion without pinning real features pending', async () => {
  const inventory = await controlledPortableInventory();
  const observed = passingReferences(inventory);
  assert.equal(evaluateCompletion(inventory, observed, 'portable').completion, 'portable-complete');
  for (const id of ['protocol.paging', 'compiler.laws-verdict']) {
    const pending = await validateInventory({ ...inventory, features: inventory.features.map(row => row.id === id
      ? { id: row.id, target: row.target, commands: row.commands, profile: row.profile, status: 'pending', reason: 'Controlled pending requirement' } : row) });
    assert.ok(evaluateCompletion(pending, observed, 'portable').blockers.some(row => row.id === id && row.status === 'pending'));
  }
  assert.ok(evaluateCompletion(inventory, observed, 'full').blockers.some(row => row.id === 'hardware.gpu'));
});

test('completion rejects excluded portable requirements and downgraded profiles', async () => {
  const inventory = await loadInventory();
  await assert.rejects(validateInventory({ ...inventory, features: inventory.features.map(row => row.id === 'protocol.paging'
    ? { id: row.id, target: row.target, commands: row.commands, profile: row.profile, status: 'excluded', reason: 'Not allowed' } : row) }), /cannot be excluded/);
  await assert.rejects(validateInventory({ ...inventory, profiles: inventory.profiles.map(row => row.profile === 'native-cpu'
    ? { profile: row.profile, status: 'unavailable', reason: 'Not allowed', prerequisites: ['CPU'] } : row) }), /requires a verified profile|cannot be unavailable/);
  const controlled = await controlledPortableInventory();
  const profile = controlled.profiles.find(row => row.profile === 'native-cpu');
  if (profile?.status !== 'verified') throw new Error('Expected CPU profile');
  const observed = passingReferences(controlled).filter(test => !profile.tests.some(ref => ref.file === test.file && ref.name === test.name));
  assert.ok(evaluateCompletion(controlled, observed, 'portable').blockers.some(row => row.id === 'profile.native-cpu'));
});

test('full completion requires observed CUDA instrumentation as well as all portable evidence', async () => {
  const inventory = await controlledPortableInventory();
  const ref = { file: 'tests/unit/coverage.test.ts', name: 'controlled GPU computation' };
  const instrument = { file: 'tests/unit/coverage.test.ts', name: 'controlled CUDA instrumentation' };
  const full = await validateInventory({ ...inventory,
    features: inventory.features.map(row => row.id === 'hardware.gpu'
      ? { id: row.id, target: row.target, commands: row.commands, profile: 'gpu', status: 'verified', tests: [ref], evidence: 'Controlled GPU fixture' } : row),
    profiles: inventory.profiles.map(row => row.profile === 'gpu'
      ? { profile: 'gpu', status: 'verified', tests: [ref], evidence: 'Controlled GPU fixture', deviceExecution: { backend: 'cuda', device: 'Controlled fixture', instrumentation: 'Device kernel observation', tests: [instrument] } } : row),
  });
  const observed = passingReferences(full);
  assert.equal(evaluateCompletion(full, observed, 'full').completion, 'in-progress');
  assert.equal(evaluateCompletion(full, [...observed, { ...instrument, status: 'passed' }], 'full').completion, 'full-complete');
  assert.equal(evaluateCompletion(full, [...observed, { ...instrument, status: 'skipped' }], 'full').completion, 'in-progress');
});

test('completion CLI requires an explicit valid mode and rejects stale completion claims', async t => {
  for (const args of [[], ['portable'], ['--mode', 'unknown'], ['--mode', 'portable', '--extra', 'x'], ['--mode', 'full', '--report'], ['--mode', 'full', '--report', '']]) {
    assert.throws(() => parseCompletionArgs(args));
  }
  assert.deepEqual(parseCompletionArgs(['--mode', 'full']), { mode: 'full', report: 'build/phase2-results.json' });
  const directory = await mkdtemp(join(tmpdir(), 'bendflow-completion-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const report = join(directory, 'report.json');
  await writeFile(report, JSON.stringify({ version: 1, completion: 'full-complete', tests: [{ file: 'tests/unit/coverage.test.ts', name: 'unrelated', status: 'passed' }] }));
  const cli = projectPath('scripts/conformance/completion.ts');
  const result = spawnSync(process.execPath, [cli, '--mode', 'portable', '--report', report], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /in-progress/);
  const noMode = spawnSync(process.execPath, [cli], { encoding: 'utf8' });
  assert.equal(noMode.status, 1);
  assert.match(noMode.stderr, /Usage:/);
  const absent = spawnSync(process.execPath, [cli, '--mode', 'full', '--report', join(directory, 'missing.json')], { encoding: 'utf8' });
  assert.equal(absent.status, 1);
  assert.match(absent.stderr, /ENOENT/);
});
