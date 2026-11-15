import { oc } from '@orpc/contract';
import { z } from 'zod';
import { u32, resourceId, text, bytes, readSize, milliseconds, failure, invalidCommand, ok, missing, opened } from './values.ts';

const host = text(64).refine(value => {
  const parts = value.split('.');
  return parts.length === 4 && parts.every(part => /^(0|[1-9][0-9]{0,2})$/.test(part) && Number(part) <= 255);
}, 'Expected an IPv4 literal');
const port = u32.max(65535);
const data = bytes();

export const networkCommandSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('connect'), host, port: port.min(1) }),
  z.strictObject({ kind: z.literal('send'), id: resourceId, bytes: data }),
  z.strictObject({ kind: z.literal('recv'), id: resourceId, max: readSize.min(1) }),
  z.strictObject({ kind: z.literal('close'), id: resourceId }),
  z.strictObject({ kind: z.literal('bind'), host, port }),
  z.strictObject({ kind: z.literal('sendTo'), id: resourceId, host, port: port.min(1), bytes: bytes(96) }),
  z.strictObject({ kind: z.literal('recvFrom'), id: resourceId, max: readSize.min(1), ms: milliseconds }),
  z.strictObject({ kind: z.literal('listen'), host, port }),
  z.strictObject({ kind: z.literal('accept'), id: resourceId }),
  z.strictObject({ kind: z.literal('tryAccept'), id: resourceId, ms: milliseconds }),
  z.strictObject({ kind: z.literal('tryRecv'), id: resourceId, max: readSize.min(1), ms: milliseconds }),
  z.strictObject({ kind: z.literal('trySend'), id: resourceId, bytes: data, ms: milliseconds }),
  z.strictObject({ kind: z.literal('trySendTo'), id: resourceId, host, port: port.min(1), bytes: bytes(96), ms: milliseconds }),
]);

export const networkReplySchema = z.discriminatedUnion('kind', [
  ok, opened, failure, missing, invalidCommand,
  z.strictObject({ kind: z.literal('bytes'), bytes: data }),
  z.strictObject({ kind: z.literal('eof') }),
  z.strictObject({ kind: z.literal('dgram'), host, port, bytes: data }),
  z.strictObject({ kind: z.literal('timeout') }),
  z.strictObject({ kind: z.literal('sendFailure'), code: u32, unsent: data }),
  z.strictObject({ kind: z.literal('sendTimeout'), unsent: data }),
  z.strictObject({ kind: z.literal('wrongResource') }),
  z.strictObject({ kind: z.literal('exhausted') }),
]);

export type NetworkCommand = z.infer<typeof networkCommandSchema>;
export type NetworkReply = z.infer<typeof networkReplySchema>;
export const networkContract = { command: oc.input(networkCommandSchema).output(networkReplySchema) };
