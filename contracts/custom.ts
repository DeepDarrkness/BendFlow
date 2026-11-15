import { oc } from '@orpc/contract';
import { z } from 'zod';
import { u32, path, failure, invalidCommand } from './values.ts';

export const customCommandSchema = z.strictObject({ kind: z.literal('mark'), path });
export const customReplySchema = z.discriminatedUnion('kind', [
  failure, invalidCommand, z.strictObject({ kind: z.literal('marked'), value: u32 }),
]);
export type CustomCommand = z.infer<typeof customCommandSchema>;
export type CustomReply = z.infer<typeof customReplySchema>;
export const customContract = { command: oc.input(customCommandSchema).output(customReplySchema) };
