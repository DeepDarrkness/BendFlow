import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { z } from 'zod';
import { environment, revision, run, source } from '../lib/toolchain.ts';
import { projectPath } from '../../src/paths.ts';
import { checkServiceBounds } from './wire.ts';

const identifier = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).refine(value => !['__proto__', 'prototype', 'constructor'].includes(value));
const nativeName = z.string().regex(/^[A-Za-z_][A-Za-z0-9_.]*$/);
export const wireSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.enum(['u32', 'bool', 'nat', 'f32', 'unit', 'char']) }),
  z.strictObject({ kind: z.literal('string'), maxBytes: z.number().int().min(0).max(247) }),
  z.strictObject({ kind: z.literal('pair'), get left() { return wireSchema; }, get right() { return wireSchema; } }),
  z.strictObject({ kind: z.literal('list'), bendType: z.string(), maxItems: z.number().int().min(0).max(255), get element() { return wireSchema; } }),
  z.strictObject({ kind: z.literal('record'), bendType: z.string(), constructor: nativeName,
    get fields() { return z.array(fieldSchema); } }),
  z.strictObject({ kind: z.literal('union'), bendType: z.string(), get cases() { return z.array(caseSchema).min(1).max(256); } }),
]);
const fieldSchema = z.strictObject({ name: identifier, value: wireSchema });
const caseSchema = z.strictObject({ name: identifier, constructor: nativeName, fields: z.array(fieldSchema) });
export type WireType = z.infer<typeof wireSchema>;
export type WireField = z.infer<typeof fieldSchema>;
const external = { name: identifier, args: z.array(fieldSchema), reply: wireSchema, call: nativeName };
const serviceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ ...external, kind: z.literal('pure') }),
  z.strictObject({ ...external, kind: z.literal('io') }),
  z.strictObject({ ...external, kind: z.literal('stateful'), state: z.string(), stateCode: z.string(), initialize: nativeName, finalize: nativeName }),
]);
const descriptionSchema = z.strictObject({ services: z.array(serviceSchema).min(1), sources: z.array(z.string()).min(1),
  imports: z.array(z.strictObject({ alias: identifier, path: z.string() })) });
export type ServiceDescription = z.infer<typeof serviceSchema>;
export type WireBounds = { maxText?: number; maxItems?: number };

export function inspectServices(entry: string, bounds: WireBounds = {}) {
  if (run('git', ['rev-parse', 'HEAD'], source) !== revision || run('git', ['status', '--porcelain', '--untracked-files=all'], source)) {
    throw new Error('Service generation requires the clean pinned Bend compiler. Run npm run setup:bend.');
  }
  const result = spawnSync(process.execPath, [projectPath('scripts/services/compiler.mjs'), resolve(source, 'bend2/bend.ts'), resolve(entry), JSON.stringify(bounds)], {
    env: environment, encoding: 'utf8', timeout: 30_000, maxBuffer: 2 * 1024 * 1024,
  });
  if (result.error) throw new Error('Service extraction failed or exceeded its deadline', { cause: result.error });
  if (result.status !== 0) throw new Error(result.stderr.trim() || 'Service extraction failed');
  const description = descriptionSchema.parse(JSON.parse(result.stdout));
  description.services.forEach(checkServiceBounds);
  return description;
}
