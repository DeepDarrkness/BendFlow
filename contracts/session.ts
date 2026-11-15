import { oc } from '@orpc/contract';
import { z } from 'zod';

const u32 = z.number().int().min(0).max(0xffffffff);

export const commandSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('add'), amount: u32 }),
  z.strictObject({ kind: z.literal('read') }),
  z.strictObject({ kind: z.literal('reset') }),
]);

const snapshotSchema = z.strictObject({ total: u32, acceptedAdds: u32 });

export const replySchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('value'), value: snapshotSchema }),
  z.strictObject({ kind: z.literal('overflow'), value: snapshotSchema }),
  z.strictObject({ kind: z.literal('invalidCommand') }),
]);

export type Command = z.infer<typeof commandSchema>;
export type SessionReply = z.infer<typeof replySchema>;

export const sessionContract = {
  command: oc.input(commandSchema).output(replySchema),
};
