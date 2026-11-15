import { oc } from '@orpc/contract';
import { z } from 'zod';
import { numericCommandSchema, numericReplySchema } from './numeric.ts';
import { collectionCommandSchema, collectionReplySchema } from './collection.ts';
import { fileCommandSchema, fileReplySchema } from './file.ts';
import { networkCommandSchema, networkReplySchema } from './network.ts';
import { taskCommandSchema, taskReplySchema } from './task.ts';
import { processCommandSchema, processReplySchema } from './process.ts';
import { computeCommandSchema, computeReplySchema } from './compute.ts';
import { customCommandSchema, customReplySchema } from './custom.ts';
import { ok } from './values.ts';

import { sessionKindSchema } from './kinds.ts';
export { sessionKindSchema } from './kinds.ts';
export const sessionIdSchema = z.uuid().brand<'SessionId'>();
export type SessionId = z.infer<typeof sessionIdSchema>;
export const executionSchema = z.discriminatedUnion('profile', [
  z.strictObject({ profile: z.literal('native-cpu') }),
  z.strictObject({ profile: z.literal('multithreaded-cpu'), threads: z.number().int().min(2).max(64) }),
]);
export const createSessionSchema = z.strictObject({
  kind: sessionKindSchema,
  execution: executionSchema.default({ profile: 'native-cpu' }),
});
export type CreateSession = z.infer<typeof createSessionSchema>;
export const createdSessionSchema = z.strictObject({
  sessionId: sessionIdSchema, kind: sessionKindSchema, execution: executionSchema,
});

export const commandKinds = {
  numeric: numericCommandSchema.options.map(option => option.shape.kind.value),
  collection: collectionCommandSchema.options.map(option => option.shape.kind.value),
  file: fileCommandSchema.options.map(option => option.shape.kind.value),
  network: networkCommandSchema.options.map(option => option.shape.kind.value),
  task: taskCommandSchema.options.map(option => option.shape.kind.value),
  process: processCommandSchema.options.map(option => option.shape.kind.value),
  compute: computeCommandSchema.options.map(option => option.shape.kind.value),
  custom: customCommandSchema.options.map(option => option.shape.kind.value),
};

function sessionCommand<Command, Reply>(command: z.ZodType<Command>, reply: z.ZodType<Reply>) {
  return { command: oc.input(z.strictObject({ sessionId: sessionIdSchema, command })).output(reply) };
}

export const appsContract = {
  sessions: {
    create: oc.input(createSessionSchema).output(createdSessionSchema),
    close: oc.input(z.strictObject({ sessionId: sessionIdSchema })).output(ok),
  },
  numeric: sessionCommand(numericCommandSchema, numericReplySchema),
  collection: sessionCommand(collectionCommandSchema, collectionReplySchema),
  file: sessionCommand(fileCommandSchema, fileReplySchema),
  network: sessionCommand(networkCommandSchema, networkReplySchema),
  task: sessionCommand(taskCommandSchema, taskReplySchema),
  process: sessionCommand(processCommandSchema, processReplySchema),
  compute: sessionCommand(computeCommandSchema, computeReplySchema),
  custom: sessionCommand(customCommandSchema, customReplySchema),
};
