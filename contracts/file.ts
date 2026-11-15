import { oc } from '@orpc/contract';
import { z } from 'zod';

import { u32, resourceId, path, bytes, readSize, failure } from './values.ts';
import { MAX_FILE_TOTAL, pageRequest, releaseRequest, pageSchema, snapshotDescriptor, pageErrors } from './pages.ts';

const mode = z.enum(['r', 'r+', 'w', 'a', 'x']);
const data = bytes();
export const MAX_FILE_IDS = 64;

export const fileCommandSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('open'), path, mode }),
  z.strictObject({ kind: z.literal('write'), id: resourceId, bytes: data }),
  z.strictObject({ kind: z.literal('read'), id: resourceId, max: readSize }),
  z.strictObject({ kind: z.literal('size'), id: resourceId }),
  z.strictObject({ kind: z.literal('readAt'), id: resourceId, offset: u32, max: readSize }),
  z.strictObject({ kind: z.literal('writeAt'), id: resourceId, offset: u32, bytes: data }),
  z.strictObject({ kind: z.literal('close'), id: resourceId }),
  z.strictObject({ kind: z.literal('capture'), id: resourceId }),
  pageRequest(192), releaseRequest,
]);

export const fileReplySchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('ok') }),
  z.strictObject({ kind: z.literal('opened'), id: resourceId }),
  z.strictObject({ kind: z.literal('bytes'), bytes: data }),
  failure,
  z.strictObject({ kind: z.literal('missing') }),
  z.strictObject({ kind: z.literal('size'), value: u32 }),
  z.strictObject({ kind: z.literal('invalidCommand') }),
  snapshotDescriptor.extend({ total: u32.max(MAX_FILE_TOTAL) }),
  pageSchema(data, MAX_FILE_TOTAL, 192), ...pageErrors,
]);

export type FileCommand = z.infer<typeof fileCommandSchema>;
export type FileReply = z.infer<typeof fileReplySchema>;
export const FILE_ENCODED_COMMAND_BOUNDS = {
  open: 101, write: 198, read: 9, size: 5, readAt: 13, writeAt: 202, close: 5, capture: 5, page: 13, release: 5,
} satisfies Record<FileCommand['kind'], number>;
export const FILE_ENCODED_REPLY_BOUNDS = {
  ok: 1, opened: 5, bytes: 194, fail: 102, missing: 1, size: 5, invalidCommand: 1,
  snapshot: 9, page: 211, stale: 1, invalidOffset: 1, limit: 1, exhausted: 1,
} satisfies Record<FileReply['kind'], number>;

export const fileContract = {
  command: oc.input(fileCommandSchema).output(fileReplySchema),
};
