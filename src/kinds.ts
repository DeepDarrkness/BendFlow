import { resolve } from 'node:path';
import { PROFILES, type ExecutionProfile } from './runtime.ts';
import {
  COLLECTION_CONTRACT, COMPUTE_CONTRACT, CUSTOM_CONTRACT, FILE_CONTRACT,
  NETWORK_CONTRACT, NUMERIC_CONTRACT, PROCESS_CONTRACT, TASK_CONTRACT,
} from './protocol/apps.ts';

export const SESSION_KINDS = [
  'numeric', 'collection', 'file', 'network', 'task', 'process', 'compute', 'custom',
] as const;

export type SessionKind = typeof SESSION_KINDS[number];

export const KIND_CONTRACTS: Record<SessionKind, string> = {
  numeric: NUMERIC_CONTRACT,
  collection: COLLECTION_CONTRACT,
  file: FILE_CONTRACT,
  network: NETWORK_CONTRACT,
  task: TASK_CONTRACT,
  process: PROCESS_CONTRACT,
  compute: COMPUTE_CONTRACT,
  custom: CUSTOM_CONTRACT,
};

export function kindExecutable(kind: SessionKind): string {
  return resolve(`build/${kind}-worker`);
}

export function capabilities(available: Partial<Record<ExecutionProfile, boolean>> = {}) {
  return {
    kinds: SESSION_KINDS.map(kind => ({ kind, contract: KIND_CONTRACTS[kind] })),
    profiles: PROFILES.map(profile => ({
      profile,
      status: profile === 'native-cpu' || available[profile] ? 'verified' as const : 'unavailable' as const,
    })),
  };
}
