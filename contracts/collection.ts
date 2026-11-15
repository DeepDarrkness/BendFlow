import { oc } from '@orpc/contract';
import { z } from 'zod';

const u32 = z.number().int().min(0).max(0xffffffff);
const text = z.string().max(96);
const items = z.array(u32).max(32);

export const collectionCommandSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('put'), key: text, value: text }),
  z.strictObject({ kind: z.literal('get'), key: text }),
  z.strictObject({ kind: z.literal('del'), key: text }),
  z.strictObject({ kind: z.literal('setItems'), items }),
  z.strictObject({ kind: z.literal('mapInc') }),
  z.strictObject({ kind: z.literal('sort') }),
  z.strictObject({ kind: z.literal('arraySet'), index: u32, value: u32 }),
  z.strictObject({ kind: z.literal('arrayGet'), index: u32 }),
  z.strictObject({ kind: z.literal('read') }),
]);

export const collectionReplySchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('ok') }),
  z.strictObject({ kind: z.literal('text'), text: z.string() }),
  z.strictObject({ kind: z.literal('missing') }),
  z.strictObject({ kind: z.literal('deleted'), text: z.string() }),
  z.strictObject({ kind: z.literal('cell'), value: u32 }),
  z.strictObject({ kind: z.literal('items'), items }),
  z.strictObject({ kind: z.literal('invalidCommand') }),
]);

export type CollectionCommand = z.infer<typeof collectionCommandSchema>;
export type CollectionReply = z.infer<typeof collectionReplySchema>;

export const collectionContract = {
  command: oc.input(collectionCommandSchema).output(collectionReplySchema),
};
