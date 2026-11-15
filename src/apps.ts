import { randomUUID } from 'node:crypto';
import { NativeApp, type AppCodec } from './app.ts';
import { KIND_CODECS, kindExecutable, type SessionKind } from './kinds.ts';
import { sessionIdSchema, type SessionId, type CreateSession } from '../contracts/apps.ts';
import { WorkerError, type WorkerOptions } from './worker.ts';
import { readHardware } from '../scripts/conformance/hardware.ts';
import { environment } from '../scripts/lib/toolchain.ts';

type OwnedApp = {
  pid: number;
  command: (input: unknown) => Promise<unknown>;
  close: () => Promise<void>;
};

async function start<Command, Reply>(codec: AppCodec<Command, Reply>, options: Omit<WorkerOptions, 'contract'>): Promise<OwnedApp> {
  const app = await NativeApp.start(codec, options);
  return { pid: app.pid, command: input => app.command(codec.parse(input)), close: () => app.close() };
}

const factories = {
  numeric: options => start(KIND_CODECS.numeric, options),
  collection: options => start(KIND_CODECS.collection, options),
  file: options => start(KIND_CODECS.file, options),
  network: options => start(KIND_CODECS.network, options),
  task: options => start(KIND_CODECS.task, options),
  process: options => start(KIND_CODECS.process, options),
  compute: options => start(KIND_CODECS.compute, options),
  custom: options => start(KIND_CODECS.custom, options),
} satisfies Record<SessionKind, (options: Omit<WorkerOptions, 'contract'>) => Promise<OwnedApp>>;

export class SessionLookupError extends Error {}

export class AppSessions {
  #sessions = new Map<SessionId, { kind: SessionKind; app: OwnedApp }>();
  #starting = new Set<Promise<unknown>>();
  #stopping = new Map<SessionId, Promise<void>>();
  #shutdown: Promise<void> | undefined;
  #worker: Omit<WorkerOptions, 'contract' | 'executable' | 'profile' | 'threads'>;
  #maxSessions: number;
  #gpuEvidence: string | undefined;

  constructor(options: {
    maxSessions?: number;
    gpuEvidence?: string;
    worker?: Omit<WorkerOptions, 'contract' | 'executable' | 'profile' | 'threads'>;
  } = {}) {
    this.#maxSessions = options.maxSessions ?? 16;
    if (!Number.isInteger(this.#maxSessions) || this.#maxSessions < 1) throw new RangeError('Invalid session limit');
    this.#worker = options.worker ?? {};
    this.#gpuEvidence = options.gpuEvidence ?? process.env.BENDFLOW_GPU_EVIDENCE;
  }

  get workerPids(): number[] { return [...this.#sessions.values()].map(row => row.app.pid); }
  get gpuHardware() { return this.#gpuEvidence ? readHardware(this.#gpuEvidence) : undefined; }

  create(input: CreateSession) {
    if (this.#shutdown) throw new SessionLookupError('Gateway is shutting down');
    if (this.#sessions.size + this.#starting.size + this.#stopping.size >= this.#maxSessions) {
      throw new SessionLimitError('Session limit reached');
    }
    const pending = this.#create(input);
    this.#starting.add(pending);
    void pending.then(() => this.#starting.delete(pending), () => this.#starting.delete(pending));
    return pending;
  }

  async #create(input: CreateSession) {
    const { execution, kind } = input;
    let executable = kindExecutable(kind);
    let env = this.#worker.env;
    if (execution.profile === 'gpu') {
      if (kind !== 'compute') throw new WorkerError('UNAVAILABLE', 'GPU execution supports only compute sessions');
      const hardware = this.gpuHardware;
      if (hardware?.status !== 'verified') throw new WorkerError('UNAVAILABLE', 'GPU execution requires current verified hardware evidence');
      executable = hardware.evidence.artifact.executable;
      env = { ...env, ...environment };
    }
    const app = await factories[kind]({
      ...this.#worker, executable, env, profile: execution.profile,
      threads: execution.profile === 'multithreaded-cpu' ? execution.threads : 1,
    });
    const sessionId = sessionIdSchema.parse(randomUUID());
    this.#sessions.set(sessionId, { kind, app });
    if (this.#shutdown) throw new SessionLookupError('Gateway is shutting down');
    return { sessionId, kind, execution };
  }

  async command<Reply>(kind: SessionKind, sessionId: SessionId, command: unknown, reply: { parse: (input: unknown) => Reply }): Promise<Reply> {
    const row = this.#sessions.get(sessionId);
    if (!row || row.kind !== kind || this.#shutdown) throw new SessionLookupError('Session not found for this kind');
    return reply.parse(await row.app.command(command));
  }

  closeSession(sessionId: SessionId): Promise<void> {
    const closing = this.#stopping.get(sessionId);
    if (closing) return closing;
    const row = this.#sessions.get(sessionId);
    if (!row) return Promise.resolve();
    this.#sessions.delete(sessionId);
    const pending = row.app.close();
    this.#stopping.set(sessionId, pending);
    void pending.then(() => this.#stopping.delete(sessionId), () => {});
    return pending;
  }

  close(): Promise<void> {
    this.#shutdown ??= this.#closeAll();
    return this.#shutdown;
  }

  async #closeAll(): Promise<void> {
    await Promise.allSettled([...this.#starting]);
    const results = await Promise.allSettled([
      ...this.#stopping.values(), ...[...this.#sessions.keys()].map(id => this.closeSession(id)),
    ]);
    const failures = results.filter(result => result.status === 'rejected').map(result => result.reason);
    if (failures.length) throw new AggregateError(failures, 'Session cleanup failed');
  }
}

export class SessionLimitError extends Error {}
