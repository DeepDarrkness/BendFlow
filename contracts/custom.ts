import { oc } from '@orpc/contract';
import { z } from 'zod';
import { u32, path, text, milliseconds, failure, invalidCommand } from './values.ts';

export const customCommandSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('mark'), path }),
  z.strictObject({ kind: z.literal('immediate'), value: u32 }),
  z.strictObject({ kind: z.literal('write'), path, text: text(149) }),
  z.strictObject({ kind: z.literal('parked'), milliseconds, value: u32 }),
  z.strictObject({ kind: z.literal('history'), offset: u32.max(32).default(0) }),
]);
export const customOutcomeSchema = z.discriminatedUnion('kind', [
  failure,
  z.strictObject({ kind: z.literal('marked'), value: u32 }),
  z.strictObject({ kind: z.literal('immediate'), value: u32 }),
  z.strictObject({ kind: z.literal('written'), value: u32 }),
  z.strictObject({ kind: z.literal('parked'), value: u32 }),
]);
export type CustomOutcome = z.infer<typeof customOutcomeSchema>;
export const customReplySchema = z.discriminatedUnion('kind', [
  ...customOutcomeSchema.options, invalidCommand,
  z.strictObject({ kind: z.literal('history'), offset: u32.max(32), total: u32.max(32), results: z.array(customOutcomeSchema).max(2) })
    .refine(page => page.offset <= page.total && page.results.length === Math.min(2, page.total - page.offset), 'Invalid custom history page'),
]);
export type CustomCommand = z.infer<typeof customCommandSchema>;
export type CustomReply = z.infer<typeof customReplySchema>;
export const customContract = { command: oc.input(customCommandSchema).output(customReplySchema) };
