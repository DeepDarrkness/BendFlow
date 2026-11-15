import { oc } from '@orpc/contract';
import { z } from 'zod';
import { u32, items, invalidCommand } from './values.ts';

export const computeCommandSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('sum'), items }),
  z.strictObject({ kind: z.literal('threads') }),
  z.strictObject({ kind: z.literal('frame') }),
]);
export const computeReplySchema = z.discriminatedUnion('kind', [
  invalidCommand,
  z.strictObject({ kind: z.literal('sum'), value: u32 }),
  z.strictObject({ kind: z.literal('threads'), value: u32.min(1) }),
  z.strictObject({ kind: z.literal('pixels'), items }),
]);
export type ComputeCommand = z.infer<typeof computeCommandSchema>;
export type ComputeReply = z.infer<typeof computeReplySchema>;
export const computeContract = { command: oc.input(computeCommandSchema).output(computeReplySchema) };
