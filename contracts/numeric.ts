import { oc } from '@orpc/contract';
import { z } from 'zod';

const u32 = z.number().int().min(0).max(0xffffffff);
const nat = z.string().regex(/^(0|[1-9][0-9]*)$/).refine(value => BigInt(value) <= (1n << 48n) - 1n);

export const numericCommandSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('accumulate'), amount: nat }),
  z.strictObject({ kind: z.literal('add'), amount: u32 }),
  z.strictObject({ kind: z.literal('read') }),
  z.strictObject({ kind: z.literal('reset') }),
  z.strictObject({ kind: z.literal('parse'), text: z.string().max(96) }),
  z.strictObject({ kind: z.literal('show') }),
  z.strictObject({ kind: z.literal('f32Add'), left: u32, right: u32 }),
  z.strictObject({ kind: z.literal('compare'), left: nat, right: nat }),
  z.strictObject({ kind: z.literal('bits'), op: z.number().int().min(0).max(2), left: u32, right: u32 }),
]);

const snapshotSchema = z.strictObject({ nat, total: u32, count: u32, f32Bits: u32 });

export const numericReplySchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('value'), value: snapshotSchema }),
  z.strictObject({ kind: z.literal('overflow'), value: snapshotSchema }),
  z.strictObject({ kind: z.literal('invalidText') }),
  z.strictObject({ kind: z.literal('text'), text: z.string() }),
  z.strictObject({ kind: z.literal('order'), order: z.enum(['lt', 'eq', 'gt']) }),
  z.strictObject({ kind: z.literal('bits'), value: u32 }),
  z.strictObject({ kind: z.literal('invalidCommand') }),
]);

export type NumericCommand = z.infer<typeof numericCommandSchema>;
export type NumericReply = z.infer<typeof numericReplySchema>;

export const numericContract = {
  command: oc.input(numericCommandSchema).output(numericReplySchema),
};
