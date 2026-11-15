import { oc } from '@orpc/contract';
import { z } from 'zod';

import { u32, text as boundedText, items } from './values.ts';

const text = boundedText();

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
  z.strictObject({ kind: z.literal('text'), text }),
  z.strictObject({ kind: z.literal('missing') }),
  z.strictObject({ kind: z.literal('deleted'), text }),
  z.strictObject({ kind: z.literal('cell'), value: u32 }),
  z.strictObject({ kind: z.literal('items'), items }),
  z.strictObject({ kind: z.literal('invalidCommand') }),
]);

export type CollectionCommand = z.infer<typeof collectionCommandSchema>;
export type CollectionReply = z.infer<typeof collectionReplySchema>;

export const collectionContract = {
  command: oc.input(collectionCommandSchema).output(collectionReplySchema),
};
