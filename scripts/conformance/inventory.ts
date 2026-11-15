import { readFile } from 'node:fs/promises';
import { relative, sep } from 'node:path';
import { z } from 'zod';
import { commandKinds } from '../../contracts/apps.ts';
import { sessionKindSchema } from '../../contracts/kinds.ts';
import { PROJECT_ROOT, projectPath } from '../../src/paths.ts';
import { PROFILES } from '../../src/runtime.ts';
import { requiredFeatureIds } from './requirements.ts';

const testReference = z.strictObject({
  file: z.string().regex(/^tests\/(?:[a-z0-9-]+\/)*[a-z0-9-]+\.test\.ts$/), name: z.string().min(1),
});
const verified = {
  status: z.literal('verified'), tests: z.array(testReference).min(1), evidence: z.string().min(1),
};
const pending = { status: z.literal('pending'), reason: z.string().min(1) };
const excluded = { status: z.literal('excluded'), reason: z.string().min(1) };
const unavailable = { status: z.literal('unavailable'), reason: z.string().min(1), prerequisites: z.array(z.string().min(1)).min(1) };
const featureBase = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9.-]+$/),
  target: z.enum([...sessionKindSchema.options, 'gateway', 'protocol', 'compiler']),
  commands: z.array(z.string().min(1)), profile: z.enum(PROFILES),
});
const feature = z.discriminatedUnion('status', [
  featureBase.extend(verified), featureBase.extend(pending), featureBase.extend(unavailable), featureBase.extend(excluded),
]);
const deviceExecution = z.strictObject({
  backend: z.literal('cuda'), device: z.string().min(1), instrumentation: z.string().min(1),
  tests: z.array(testReference).min(1),
});
const profileBase = z.strictObject({ profile: z.enum(PROFILES) });
const profile = z.discriminatedUnion('status', [
  profileBase.extend({ ...verified, deviceExecution: deviceExecution.optional() }),
  profileBase.extend(pending), profileBase.extend(unavailable), profileBase.extend(excluded),
]);

export const inventorySchema = z.strictObject({ version: z.literal(1), features: z.array(feature).min(1), profiles: z.array(profile) });
export type Inventory = z.infer<typeof inventorySchema>;
export const excludedFeatureIds = ['hardware.window', 'hardware.audio'];
export const portableProfiles = ['native-cpu', 'multithreaded-cpu'];

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
    if (excludedFeatureIds.includes(row.id)) {
      if (row.status !== 'excluded' || row.profile !== 'graphics-audio') throw new Error(`Agreed excluded feature ${row.id} must remain excluded in graphics-audio`);
    } else if (row.status === 'excluded') {
      throw new Error(`In-scope feature ${row.id} cannot be excluded`);
    } else if (row.id === 'hardware.gpu') {
      if (row.profile !== 'gpu') throw new Error('hardware.gpu requires the GPU profile');
    } else if (!portableProfiles.includes(row.profile)) {
      throw new Error(`Required portable feature ${row.id} requires a portable profile`);
    }
    if (row.status === 'verified' && !inventory.profiles.some(profile => profile.profile === row.profile && profile.status === 'verified')) {
      throw new Error(`Verified feature ${row.id} requires a verified profile`);
    }
    if (row.status === 'unavailable' && row.profile !== 'gpu' && row.profile !== 'graphics-audio') {
      throw new Error(`Required portable feature ${row.id} cannot be unavailable`);
    }
  }
  for (const row of inventory.profiles) {
    if (row.profile === 'graphics-audio') {
      if (row.status !== 'excluded') throw new Error('graphics-audio must remain excluded from the agreed scope');
    } else if (row.status === 'excluded') {
      throw new Error(`In-scope profile ${row.profile} cannot be excluded`);
    } else if (portableProfiles.includes(row.profile) && row.status === 'unavailable') {
      throw new Error(`Required portable profile ${row.profile} cannot be unavailable`);
    }
    if (row.status === 'verified' && row.profile === 'gpu' && !row.deviceExecution) {
      throw new Error('Verified GPU profile requires CUDA device execution instrumentation');
    }
    if (row.status === 'verified' && row.profile !== 'gpu' && row.deviceExecution) {
      throw new Error('Device execution instrumentation requires the GPU profile');
    }
  }
  const references = [...inventory.features, ...inventory.profiles].flatMap(row => row.status === 'verified' ? row.tests : []);
  const gpu = inventory.profiles.find(row => row.profile === 'gpu');
  if (gpu?.status === 'verified' && gpu.deviceExecution) references.push(...gpu.deviceExecution.tests);
  const files = new Set(references.map(test => test.file));
  await Promise.all([...files].map(file => readFile(projectPath(file), 'utf8')));
  return inventory;
}

export async function loadInventory(): Promise<Inventory> {
  return validateInventory(JSON.parse(await readFile(projectPath('tests/conformance/coverage.json'), 'utf8')));
}

export const observedTestSchema = z.strictObject({ file: z.string().min(1), name: z.string().min(1), status: z.enum(['passed', 'failed', 'skipped']) });
export type ObservedTest = z.infer<typeof observedTestSchema>;

export function normalizeTestFile(file: string): string {
  return relative(PROJECT_ROOT, projectPath(file)).split(sep).join('/');
}

export function evaluateInventory(inventory: Inventory, observed: ObservedTest[]) {
  function verification(row: { tests: z.infer<typeof testReference>[] }): { status: 'failed' | 'verified'; missing: z.infer<typeof testReference>[] } {
    const missing = row.tests.filter(ref => {
      const matches = observed.filter(test => normalizeTestFile(test.file) === normalizeTestFile(ref.file) && test.name === ref.name);
      return !matches.length || matches.some(test => test.status !== 'passed');
    });
    return { status: missing.length ? 'failed' : 'verified', missing };
  }
  return {
    features: inventory.features.map(row => {
      if (row.status !== 'verified') return row;
      const profile = inventory.profiles.find(profile => profile.profile === row.profile);
      const profileTests = profile?.status === 'verified'
        ? [...profile.tests, ...(profile.deviceExecution?.tests ?? [])] : [];
      return { ...row, ...verification({ tests: [...row.tests, ...profileTests] }) };
    }),
    profiles: inventory.profiles.map(row => row.status === 'verified'
      ? { ...row, ...verification({ tests: [...row.tests, ...(row.deviceExecution?.tests ?? [])] }) } : row),
  };
}
