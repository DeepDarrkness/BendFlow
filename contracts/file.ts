import { oc } from '@orpc/contract';
import { z } from 'zod';

import { u32, resourceId, path, bytes, readSize, failure } from './values.ts';

const mode = z.enum(['r', 'r+', 'w', 'a', 'x']);
const data = bytes();

export const fileCommandSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('open'), path, mode }),
  z.strictObject({ kind: z.literal('write'), id: resourceId, bytes: data }),
  z.strictObject({ kind: z.literal('read'), id: resourceId, max: readSize }),
  z.strictObject({ kind: z.literal('size'), id: resourceId }),
  z.strictObject({ kind: z.literal('readAt'), id: resourceId, offset: u32, max: readSize }),
  z.strictObject({ kind: z.literal('writeAt'), id: resourceId, offset: u32, bytes: data }),
  z.strictObject({ kind: z.literal('close'), id: resourceId }),
]);

export const fileReplySchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('ok') }),
  z.strictObject({ kind: z.literal('opened'), id: resourceId }),
  z.strictObject({ kind: z.literal('bytes'), bytes: data }),
  failure,
  z.strictObject({ kind: z.literal('missing') }),
  z.strictObject({ kind: z.literal('size'), value: u32 }),
  z.strictObject({ kind: z.literal('invalidCommand') }),
]);

export type FileCommand = z.infer<typeof fileCommandSchema>;
export type FileReply = z.infer<typeof fileReplySchema>;

export const fileContract = {
  command: oc.input(fileCommandSchema).output(fileReplySchema),
};
