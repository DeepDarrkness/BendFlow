import { oc } from '@orpc/contract';
import { z } from 'zod';

const u32 = z.number().int().min(0).max(0xffffffff);
const path = z.string().max(96);
const mode = z.enum(['r', 'r+', 'w', 'a', 'x']);
const bytes = z.custom<Uint8Array>(value => value instanceof Uint8Array && value.byteLength <= 192);

export const fileCommandSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('open'), path, mode }),
  z.strictObject({ kind: z.literal('write'), id: u32, bytes }),
  z.strictObject({ kind: z.literal('read'), id: u32, max: u32 }),
  z.strictObject({ kind: z.literal('size'), id: u32 }),
  z.strictObject({ kind: z.literal('readAt'), id: u32, offset: u32, max: u32 }),
  z.strictObject({ kind: z.literal('writeAt'), id: u32, offset: u32, bytes }),
  z.strictObject({ kind: z.literal('close'), id: u32 }),
]);

export const fileReplySchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('ok') }),
  z.strictObject({ kind: z.literal('opened'), id: u32 }),
  z.strictObject({ kind: z.literal('bytes'), bytes }),
  z.strictObject({ kind: z.literal('fail'), code: u32, message: z.string() }),
  z.strictObject({ kind: z.literal('missing') }),
  z.strictObject({ kind: z.literal('size'), value: u32 }),
  z.strictObject({ kind: z.literal('invalidCommand') }),
]);

export type FileCommand = z.infer<typeof fileCommandSchema>;
export type FileReply = z.infer<typeof fileReplySchema>;

export const fileContract = {
  command: oc.input(fileCommandSchema).output(fileReplySchema),
};
