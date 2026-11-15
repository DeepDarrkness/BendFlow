import { PROFILES } from './runtime.ts';
import { SESSION_KINDS, type SessionKind } from '../contracts/kinds.ts';
import { projectPath } from './paths.ts';
import {
  numericCodec, collectionCodec, fileCodec, networkCodec, taskCodec, processCodec, computeCodec, customCodec,
} from './protocol/apps.ts';

export { SESSION_KINDS, type SessionKind } from '../contracts/kinds.ts';

export const KIND_CODECS = {
  numeric: numericCodec, collection: collectionCodec, file: fileCodec, network: networkCodec,
  task: taskCodec, process: processCodec, compute: computeCodec, custom: customCodec,
} satisfies Record<SessionKind, { contract: string }>;

export function kindExecutable(kind: SessionKind): string {
  return projectPath('build', `${kind}-worker`);
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
