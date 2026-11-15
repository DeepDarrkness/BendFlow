import { z } from 'zod';

export const MAX_TEXT = 96;
export const MAX_BYTES = 192;
export const MAX_ITEMS = 32;
export const MAX_NAT = (1n << 48n) - 1n;
export const u32 = z.number().int().min(0).max(0xffffffff);
export const resourceId = u32.min(1);
export const milliseconds = u32.max(10_000);
export const readSize = u32.max(MAX_BYTES);

export function text(max = MAX_TEXT) {
  return z.string().refine(value => value.isWellFormed() && Buffer.byteLength(value, 'utf8') <= max,
    `Expected well-formed text of at most ${max} UTF-8 bytes`);
}

export function bytes(max = MAX_BYTES) {
  return z.custom<Uint8Array>(value => value instanceof Uint8Array && value.byteLength <= max,
    `Expected at most ${max} bytes`);
}

export const path = text().refine(value => value.length > 0 && !value.includes('\0'), 'Invalid native path');
export const items = z.array(u32).max(MAX_ITEMS);
export const nat = z.string().max(15).regex(/^(0|[1-9][0-9]*)$/)
  .refine(value => /^(0|[1-9][0-9]*)$/.test(value) && BigInt(value) <= MAX_NAT, 'Nat exceeds native limit');
export const failure = z.strictObject({ kind: z.literal('fail'), code: u32, message: text() });
export const invalidCommand = z.strictObject({ kind: z.literal('invalidCommand') });
export const ok = z.strictObject({ kind: z.literal('ok') });
export const missing = z.strictObject({ kind: z.literal('missing') });
export const opened = z.strictObject({ kind: z.literal('opened'), id: resourceId });
