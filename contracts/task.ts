import { oc } from '@orpc/contract';
import { z } from 'zod';
import { resourceId, text, milliseconds, ok, missing, invalidCommand } from './values.ts';

export const taskCommandSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('nap'), ms: milliseconds }),
  z.strictObject({ kind: z.literal('start'), ms: milliseconds, text: text(64) }),
  z.strictObject({ kind: z.literal('join'), id: resourceId }),
  z.strictObject({ kind: z.literal('timeout'), limit: milliseconds, ms: milliseconds, text: text(32) }),
]);
export const taskReplySchema = z.discriminatedUnion('kind', [
  ok, missing, invalidCommand,
  z.strictObject({ kind: z.literal('started'), id: resourceId }),
  z.strictObject({ kind: z.literal('text'), text: text(64) }),
  z.strictObject({ kind: z.literal('timeout') }),
]);
export type TaskCommand = z.infer<typeof taskCommandSchema>;
export type TaskReply = z.infer<typeof taskReplySchema>;
export const taskContract = { command: oc.input(taskCommandSchema).output(taskReplySchema) };
