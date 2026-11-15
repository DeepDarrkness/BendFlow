import { z } from 'zod';
import { u32, resourceId } from './values.ts';

export const MAX_COLLECTION_TOTAL = 1024;
export const MAX_FILE_TOTAL = 65536;
export const ITEMS_PAGE_CAP = 32;
export const BYTES_PAGE_CAP = 192;
export const snapshotDescriptor = z.strictObject({ kind: z.literal('snapshot'), snapshot: resourceId, total: u32 });
export const pageErrors = [
  z.strictObject({ kind: z.literal('stale') }),
  z.strictObject({ kind: z.literal('invalidOffset') }),
  z.strictObject({ kind: z.literal('limit') }),
  z.strictObject({ kind: z.literal('exhausted') }),
];
export function pageRequest(cap: number) {
  return z.strictObject({ kind: z.literal('page'), snapshot: resourceId, offset: u32, max: u32.min(1).max(cap) });
}
export const releaseRequest = z.strictObject({ kind: z.literal('release'), snapshot: resourceId });
export function pageSchema<T extends z.ZodType>(data: T, totalLimit: number, cap: number) {
  return z.strictObject({ kind: z.literal('page'), snapshot: resourceId, offset: u32,
    total: u32.max(totalLimit), count: u32.max(cap), done: z.boolean(), data }).superRefine((page, ctx) => {
    const value = 'data' in page ? page.data : undefined;
    const length = value instanceof Uint8Array || Array.isArray(value) ? value.length : -1;
    if (page.count !== length || page.offset > page.total || page.offset + page.count > page.total ||
        page.done !== (page.offset + page.count === page.total) || (!page.done && page.count === 0)) {
      ctx.addIssue({ code: 'custom', message: 'Inconsistent page envelope' });
    }
  });
}

export async function collectSnapshot(options: {
  descriptor: unknown;
  totalLimit: number;
  pageCap: number;
  read: (offset: number, max: number) => Promise<unknown>;
}): Promise<number[]> {
  u32.parse(options.totalLimit);
  u32.min(1).max(BYTES_PAGE_CAP).parse(options.pageCap);
  const descriptor = snapshotDescriptor.extend({ total: u32.max(options.totalLimit) }).parse(options.descriptor);
  const schema = pageSchema(z.union([z.array(u32).max(options.pageCap), z.custom<Uint8Array>(value => value instanceof Uint8Array && value.length <= options.pageCap)]), options.totalLimit, options.pageCap);
  const result: number[] = [];
  for (;;) {
    const page = schema.parse(await options.read(result.length, options.pageCap));
    if (page.snapshot !== descriptor.snapshot || page.total !== descriptor.total || page.offset !== result.length) {
      throw new Error('Snapshot identity, total, or offset changed');
    }
    result.push(...page.data);
    if (page.done) return result;
  }
}
