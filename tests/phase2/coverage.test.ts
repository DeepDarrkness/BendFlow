import assert from 'node:assert/strict';
import test from 'node:test';
import { loadInventory, validateInventory, evaluateInventory } from '../../scripts/conformance.ts';

test('coverage inventory maps supported commands and explicit unfinished Phase 2 features', async () => {
  const inventory = await loadInventory();
  assert.ok(inventory.features.some(row => row.status === 'pending' && row.id === 'protocol.paging'));
  assert.ok(inventory.features.some(row => row.status === 'pending' && row.id === 'compiler.laws-verdict'));
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
  await assert.rejects(validateInventory({ ...inventory, features: inventory.features.map(row => row.id === cpu.id ? { ...row, profile: 'gpu' } : row) }), /requires a verified profile/);
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
    const report = evaluateInventory(inventory, [{ ...ref, status }]);
    assert.equal(report.features.find(feature => feature.id === row.id)?.status, 'failed');
  }
  const report = evaluateInventory(inventory, [{ ...ref, status: 'passed' }]);
  assert.equal(report.features.find(feature => feature.id === row.id)?.status, 'verified');
  assert.equal(report.features.find(feature => feature.id === 'protocol.paging')?.status, 'pending');
});
