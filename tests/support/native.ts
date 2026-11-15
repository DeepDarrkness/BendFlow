import type { TestContext } from 'node:test';
import { NativeApp, type AppCodec } from '../../src/app.ts';
import { NativeSession } from '../../src/session.ts';
import { BendWorker, type WorkerOptions } from '../../src/worker.ts';
import { projectPath } from '../../src/paths.ts';
import { ownNative } from './resources.ts';

export const executable = projectPath('build/echo-worker');

export async function app<Command, Reply>(t: TestContext, codec: AppCodec<Command, Reply>, name: string,
  options: Omit<WorkerOptions, 'executable' | 'contract'> = {}) {
  return ownNative(t, await NativeApp.start(codec, { executable: projectPath(`build/${name}-worker`), ...options }));
}

export async function session(t: TestContext, callMs = 500) {
  return ownNative(t, await NativeSession.start({ executable: projectPath('build/session-worker'), callMs }));
}

export async function worker(t: TestContext, options: WorkerOptions = { executable }) {
  return ownNative(t, await BendWorker.start(options));
}
