import { oc } from '@orpc/contract';
import { z } from 'zod';
import { u32, path, text, failure, invalidCommand } from './values.ts';

export const processCommandSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('env'), name: text().refine(value => value.length > 0 && !/[=\0]/.test(value)) }),
  z.strictObject({ kind: z.literal('args') }),
  z.strictObject({ kind: z.literal('run'), program: path, arg: text(64).refine(value => !value.includes('\0')), input: text(64) }),
  z.strictObject({ kind: z.literal('random') }),
  z.strictObject({ kind: z.literal('fixture'), behavior: z.enum(['report', 'success', 'timeout', 'overflow']), arg: text(32).refine(value => !value.includes('\0')), input: text(32) }),
]);
export const processReplySchema = z.discriminatedUnion('kind', [
  failure, invalidCommand,
  z.strictObject({ kind: z.literal('text'), text: text() }),
  z.strictObject({ kind: z.literal('run'), code: u32, stdout: text(), stderr: text() }),
  z.strictObject({ kind: z.literal('random'), value: u32 }),
]);
export type ProcessCommand = z.infer<typeof processCommandSchema>;
export type ProcessReply = z.infer<typeof processReplySchema>;
export const processContract = { command: oc.input(processCommandSchema).output(processReplySchema) };
