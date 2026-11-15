import { oc } from '@orpc/contract';
import { z } from 'zod';
import { u32, items, invalidCommand } from './values.ts';
import { ITEMS_PAGE_CAP, pageRequest, releaseRequest, pageSchema, snapshotDescriptor } from './pages.ts';

export const COMPUTE_MAX_TOTAL = 512;
export const computeEventSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('key'), code: u32, down: z.boolean() }),
  z.strictObject({ kind: z.literal('focus'), on: z.boolean() }),
  z.strictObject({ kind: z.literal('close') }),
]);

export const computeCommandSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('sum'), items }),
  z.strictObject({ kind: z.literal('threads') }),
  z.strictObject({ kind: z.literal('frame') }),
  z.strictObject({ kind: z.literal('sort'), items }),
  z.strictObject({ kind: z.literal('advance'), steps: u32.max(1024) }),
  z.strictObject({ kind: z.literal('inspect') }),
  z.strictObject({ kind: z.literal('reset') }),
  z.strictObject({ kind: z.literal('event'), event: computeEventSchema }),
  z.strictObject({ kind: z.literal('render'), depth: u32.max(4) }),
  z.strictObject({ kind: z.literal('samples'), count: u32.max(COMPUTE_MAX_TOTAL) }),
  pageRequest(ITEMS_PAGE_CAP),
  releaseRequest,
]);

export const computePageSchema = pageSchema(z.array(u32).max(ITEMS_PAGE_CAP), COMPUTE_MAX_TOTAL, ITEMS_PAGE_CAP);
export const computeReplySchema = z.discriminatedUnion('kind', [
  invalidCommand,
  z.strictObject({ kind: z.literal('sum'), value: u32 }),
  z.strictObject({ kind: z.literal('threads'), value: u32.min(1) }),
  z.strictObject({ kind: z.literal('pixels'), items }),
  z.strictObject({ kind: z.literal('sorted'), items }),
  z.strictObject({ kind: z.literal('simulation'), tick: u32.max(10000), position: u32.max(255), velocity: u32.min(1).max(2), running: z.boolean(), closed: z.boolean() }),
  snapshotDescriptor.extend({ total: u32.max(COMPUTE_MAX_TOTAL) }),
  computePageSchema,
  z.strictObject({ kind: z.literal('ok') }),
  z.strictObject({ kind: z.literal('error'), reason: z.enum(['busy', 'stale', 'range', 'exhausted', 'overflow']) }),
]);
export type ComputeCommand = z.infer<typeof computeCommandSchema>;
export type ComputeReply = z.infer<typeof computeReplySchema>;
export const computeContract = { command: oc.input(computeCommandSchema).output(computeReplySchema) };
