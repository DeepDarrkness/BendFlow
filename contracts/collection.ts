import { oc } from '@orpc/contract';
import { z } from 'zod';

import { u32, text as boundedText, items } from './values.ts';
import { MAX_COLLECTION_TOTAL, pageRequest, releaseRequest, pageSchema, snapshotDescriptor, pageErrors } from './pages.ts';

const text = boundedText();
const shortText = boundedText(24);
export const nestedRecordSchema = z.strictObject({
  name: shortText, point: z.tuple([u32, u32]), optional: u32.nullable(),
  choice: z.discriminatedUnion('kind', [z.strictObject({ kind: z.literal('number'), value: u32 }), z.strictObject({ kind: z.literal('text'), text: shortText })]),
  items: z.array(u32).max(16),
});

export const collectionCommandSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('put'), key: text, value: text }),
  z.strictObject({ kind: z.literal('get'), key: text }),
  z.strictObject({ kind: z.literal('del'), key: text }),
  z.strictObject({ kind: z.literal('setItems'), items }),
  z.strictObject({ kind: z.literal('mapInc') }),
  z.strictObject({ kind: z.literal('sort') }),
  z.strictObject({ kind: z.literal('arraySet'), index: u32, value: u32 }),
  z.strictObject({ kind: z.literal('arrayGet'), index: u32 }),
  z.strictObject({ kind: z.literal('arrayRead') }),
  z.strictObject({ kind: z.literal('read') }),
  z.strictObject({ kind: z.literal('appendItems'), items }),
  z.strictObject({ kind: z.literal('capture') }),
  pageRequest(32), releaseRequest,
  z.strictObject({ kind: z.literal('putNested'), record: nestedRecordSchema }),
  z.strictObject({ kind: z.literal('getNested') }),
  z.strictObject({ kind: z.literal('set'), add: shortText, remove: shortText, has: shortText }),
  z.strictObject({ kind: z.literal('fold') }),
  z.strictObject({ kind: z.literal('transform'), value: u32, text: shortText }),
  z.strictObject({ kind: z.literal('storeClosure'), amount: u32 }),
  z.strictObject({ kind: z.literal('consumeClosure'), value: u32 }),
  z.strictObject({ kind: z.literal('sized') }),
  z.strictObject({ kind: z.literal('maybe'), left: shortText, right: shortText }),
  z.strictObject({ kind: z.literal('result'), left: shortText, right: shortText }),
]);

export const collectionReplySchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('ok') }),
  z.strictObject({ kind: z.literal('text'), text }),
  z.strictObject({ kind: z.literal('missing') }),
  z.strictObject({ kind: z.literal('deleted'), text }),
  z.strictObject({ kind: z.literal('cell'), value: u32 }),
  z.strictObject({ kind: z.literal('items'), items }),
  z.strictObject({ kind: z.literal('invalidCommand') }),
  snapshotDescriptor.extend({ total: u32.max(MAX_COLLECTION_TOTAL) }),
  pageSchema(items, MAX_COLLECTION_TOTAL, 32), ...pageErrors,
  z.strictObject({ kind: z.literal('nested'), record: nestedRecordSchema }),
  z.strictObject({ kind: z.literal('set'), size: u32, has: z.boolean() }),
  z.strictObject({ kind: z.literal('transformed'), values: z.tuple([u32, u32, u32]), text: shortText }),
  z.strictObject({ kind: z.literal('maybe'), value: u32.nullable() }),
  z.strictObject({ kind: z.literal('result'), value: u32 }),
  z.strictObject({ kind: z.literal('resultError'), error: z.enum(['left', 'right']) }),
]);

export type CollectionCommand = z.infer<typeof collectionCommandSchema>;
export type CollectionReply = z.infer<typeof collectionReplySchema>;
export const COLLECTION_ENCODED_COMMAND_BOUNDS = {
  put: 195, get: 98, del: 98, setItems: 130, mapInc: 1, sort: 1, arraySet: 9, arrayGet: 5, read: 1,
  appendItems: 130, capture: 1, page: 13, release: 5, putNested: 140, getNested: 1, set: 76, fold: 1,
  transform: 30, storeClosure: 5, consumeClosure: 5, sized: 1, maybe: 51, result: 51, arrayRead: 1,
} satisfies Record<CollectionCommand['kind'], number>;
export const COLLECTION_ENCODED_REPLY_BOUNDS = {
  ok: 1, text: 98, missing: 1, deleted: 98, cell: 5, items: 130, invalidCommand: 1, snapshot: 9, page: 147,
  stale: 1, invalidOffset: 1, limit: 1, exhausted: 1, nested: 140, set: 6, transformed: 38, maybe: 6, result: 5, resultError: 2,
} satisfies Record<CollectionReply['kind'], number>;

export const collectionContract = {
  command: oc.input(collectionCommandSchema).output(collectionReplySchema),
};
