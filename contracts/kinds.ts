import { z } from 'zod';

export const SESSION_KINDS = ['numeric', 'collection', 'file', 'network', 'task', 'process', 'compute', 'custom'] as const;
export const sessionKindSchema = z.enum(SESSION_KINDS);
export type SessionKind = z.infer<typeof sessionKindSchema>;
