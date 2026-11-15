import { resolve } from 'node:path';
import { PROFILES } from './runtime.ts';
import { sessionKindSchema } from '../contracts/apps.ts';
import {
  numericCodec, collectionCodec, fileCodec, networkCodec, taskCodec, processCodec, computeCodec, customCodec,
} from './protocol/apps.ts';

export const SESSION_KINDS = sessionKindSchema.options;

export type SessionKind = typeof SESSION_KINDS[number];

export const KIND_CODECS = {
  numeric: numericCodec, collection: collectionCodec, file: fileCodec, network: networkCodec,
  task: taskCodec, process: processCodec, compute: computeCodec, custom: customCodec,
} satisfies Record<SessionKind, { contract: string }>;

export function kindExecutable(kind: SessionKind): string {
  return resolve(`build/${kind}-worker`);
}

export function capabilities() {
  return {
    kinds: SESSION_KINDS.map(kind => ({ kind, contract: KIND_CODECS[kind].contract })),
    profiles: PROFILES.map(profile => {
      if (profile === 'gpu') return { profile, status: 'unavailable' as const, reason: 'No configured GPU execution instrumentation' };
      if (profile === 'graphics-audio') return { profile, status: 'unavailable' as const, reason: 'No configured display or audio capture fixture' };
      return { profile, status: 'available' as const };
    }),
  };
}
