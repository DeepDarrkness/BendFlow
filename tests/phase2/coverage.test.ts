import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { SESSION_KINDS } from '../../src/kinds.ts';
import { PROFILES } from '../../src/runtime.ts';

test('coverage inventory maps every session kind and profile', async () => {
  const inventory = JSON.parse(await readFile('tests/phase2/coverage.json', 'utf8')) as {
    sessions: { kind: string; evidence: string }[];
    profiles: { profile: string; status: string }[];
    compiler: { feature: string; evidence: string }[];
  };
  assert.deepEqual(inventory.sessions.map(row => row.kind).sort(), [...SESSION_KINDS].sort());
  assert.ok(inventory.sessions.every(row => row.evidence.length > 0));
  assert.deepEqual(inventory.profiles.map(row => row.profile), [...PROFILES]);
  assert.ok(inventory.compiler.length >= 2);
});
