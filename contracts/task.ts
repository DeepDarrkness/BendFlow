import { oc } from '@orpc/contract';
import { z } from 'zod';
import { resourceId, text, path, milliseconds, ok, missing, failure, invalidCommand } from './values.ts';

export const taskCommandSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('nap'), ms: milliseconds }),
  z.strictObject({ kind: z.literal('start'), ms: milliseconds, text: text(64) }),
  z.strictObject({ kind: z.literal('join'), id: resourceId }),
  z.strictObject({ kind: z.literal('timeout'), limit: milliseconds, ms: milliseconds, text: text(32) }),
  z.strictObject({ kind: z.literal('channels'), text: text(64) }),
  z.strictObject({ kind: z.literal('openFile'), path }),
  z.strictObject({ kind: z.literal('writeFile'), text: text(64) }),
  z.strictObject({ kind: z.literal('transfer'), text: text(64) }),
  z.strictObject({ kind: z.literal('release') }),
  z.strictObject({ kind: z.literal('collect') }),
  z.strictObject({ kind: z.literal('closeFile') }),
]);
export const taskReplySchema = z.discriminatedUnion('kind', [
  ok, missing, failure, invalidCommand,
  z.strictObject({ kind: z.literal('started'), id: resourceId }),
  z.strictObject({ kind: z.literal('text'), text: text(64) }),
  z.strictObject({ kind: z.literal('timeout') }),
]);
export type TaskCommand = z.infer<typeof taskCommandSchema>;
export type TaskReply = z.infer<typeof taskReplySchema>;
export const taskContract = { command: oc.input(taskCommandSchema).output(taskReplySchema) };
