import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { commandKinds, sessionKindSchema } from '../contracts/apps.ts';
import { PROFILES } from '../src/runtime.ts';
import { requiredFeatureIds } from './phase2-requirements.ts';

const testReference = z.strictObject({
  file: z.string().regex(/^tests\/(?:[a-z0-9-]+\/)*[a-z0-9-]+\.test\.ts$/), name: z.string().min(1),
});
const verified = {
  status: z.literal('verified'), tests: z.array(testReference).min(1), evidence: z.string().min(1),
};
const pending = { status: z.literal('pending'), reason: z.string().min(1) };
const unavailable = { status: z.literal('unavailable'), reason: z.string().min(1), prerequisites: z.array(z.string().min(1)).min(1) };
const featureBase = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9.-]+$/),
  target: z.enum([...sessionKindSchema.options, 'gateway', 'protocol', 'compiler']),
  commands: z.array(z.string().min(1)), profile: z.enum(PROFILES),
});
const feature = z.discriminatedUnion('status', [
  featureBase.extend(verified), featureBase.extend(pending), featureBase.extend(unavailable),
]);
const profileBase = z.strictObject({ profile: z.enum(PROFILES) });
const profile = z.discriminatedUnion('status', [
  profileBase.extend(verified), profileBase.extend(pending), profileBase.extend(unavailable),
]);

export const inventorySchema = z.strictObject({ version: z.literal(1), features: z.array(feature).min(1), profiles: z.array(profile) });
export type Inventory = z.infer<typeof inventorySchema>;

export async function validateInventory(input: unknown): Promise<Inventory> {
  const inventory = inventorySchema.parse(input);
  if (new Set(inventory.features.map(row => row.id)).size !== inventory.features.length) throw new Error('Duplicate feature ID');
  for (const id of requiredFeatureIds) {
    if (!inventory.features.some(row => row.id === id)) throw new Error(`Missing required feature: ${id}`);
  }
  if (new Set(inventory.profiles.map(row => row.profile)).size !== inventory.profiles.length) throw new Error('Duplicate profile');
  if (inventory.profiles.length !== PROFILES.length || PROFILES.some(name => !inventory.profiles.some(row => row.profile === name))) {
    throw new Error('Inventory must describe every execution profile');
  }
  for (const [kind, commands] of Object.entries(commandKinds)) {
    for (const command of commands) {
      if (!inventory.features.some(row => row.target === kind && row.commands.includes(command))) {
        throw new Error(`Missing command coverage: ${kind}.${command}`);
      }
    }
  }
  for (const row of inventory.features) {
    if (row.status === 'verified' && !inventory.profiles.some(profile => profile.profile === row.profile && profile.status === 'verified')) {
      throw new Error(`Verified feature ${row.id} requires a verified profile`);
    }
    if (row.status === 'unavailable' && row.profile !== 'gpu' && row.profile !== 'graphics-audio') {
      throw new Error(`Required portable feature ${row.id} cannot be unavailable`);
    }
  }
  const files = new Set([...inventory.features, ...inventory.profiles].flatMap(row => row.status === 'verified' ? row.tests.map(test => test.file) : []));
  await Promise.all([...files].map(file => readFile(file, 'utf8')));
  return inventory;
}

export async function loadInventory(): Promise<Inventory> {
  return validateInventory(JSON.parse(await readFile('tests/phase2/coverage.json', 'utf8')));
}

export type ObservedTest = { file: string; name: string; status: 'passed' | 'failed' | 'skipped' };

export function evaluateInventory(inventory: Inventory, observed: ObservedTest[]) {
  function verification(row: { tests: z.infer<typeof testReference>[] }): { status: 'failed' | 'verified'; missing: z.infer<typeof testReference>[] } {
    const missing = row.tests.filter(ref => !observed.some(test => test.file === ref.file && test.name === ref.name && test.status === 'passed'));
    return { status: missing.length ? 'failed' : 'verified', missing };
  }
  return {
    features: inventory.features.map(row => row.status === 'verified' ? { ...row, ...verification(row) } : row),
    profiles: inventory.profiles.map(row => row.status === 'verified' ? { ...row, ...verification(row) } : row),
  };
}
