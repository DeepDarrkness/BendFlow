import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { sessionIdSchema, type SessionId } from '../contracts/apps.ts';
import { NativeApp, type AppCodec } from './app.ts';
import { validatedCodec } from './protocol/codec.ts';
import { WorkerError, type WorkerOptions } from './worker.ts';

type Parser<T> = Readonly<{ parse: (input: unknown) => T }>;
type StartOptions = Omit<WorkerOptions, 'contract' | 'executable' | 'profile' | 'threads'>;
type OwnedApp = Readonly<{
  pid: number;
  command: (input: unknown) => Promise<unknown>;
  close: () => Promise<void>;
}>;
type OwnedService = Readonly<{
  name: string;
  start: (options: StartOptions) => Promise<OwnedApp>;
}>;

export type Service<Args, Reply> = OwnedService & Readonly<{
  args: Parser<Args>;
  reply: Parser<Reply>;
}>;

export type ServiceHostOptions = Readonly<{
  maxSessions?: number;
  maxWaiting?: number;
  waitMs?: number;
  drainMs?: number;
  worker?: StartOptions;
}>;
export type InvocationOptions = Readonly<{ signal?: AbortSignal }>;

export class ServiceLookupError extends Error {}
export class ServiceLimitError extends Error {}
export class ServiceWaitError extends Error {}

export function defineService<Args, Reply>(options: {
  name: string;
  executable: string;
  codec: AppCodec<Args, Reply>;
  reply: Parser<Reply>;
}): Service<Args, Reply> {
  const { name, executable, codec, reply } = options;
  if (!name.length) throw new RangeError('Invalid service name');
  const checkedCodec = validatedCodec(codec, reply);
  return Object.freeze({
    name,
    args: { parse: (input: unknown) => codec.parse(input) },
    reply,
    start: async (worker: StartOptions): Promise<OwnedApp> => {
      const app = await NativeApp.start(checkedCodec, {
        ...worker, executable, profile: 'native-cpu', threads: 1,
      });
      return {
        pid: app.pid,
        command: input => app.command(codec.parse(input)),
        close: () => app.close(),
      };
    },
  });
}

type Job = {
  input: unknown;
  expiresAt: number;
  signal: AbortSignal | undefined;
  completion: ReturnType<typeof Promise.withResolvers<unknown>>;
  disposeWaitingHooks: () => void;
};
type Phase =
  | { kind: 'idle' }
  | { kind: 'active'; job: Job; settled: Promise<void> }
  | { kind: 'closing'; completion: Promise<void> };
type SessionRow = {
  sessionId: SessionId;
  service: OwnedService;
  app: OwnedApp;
  phase: Phase;
  waiting: Job[];
};
type Stop = Readonly<{ app: OwnedApp; completion: Promise<void> }>;
type CreatedSession = { sessionId: SessionId; service: string };

function count(value: number, minimum: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < minimum) throw new RangeError(`Invalid ${label}`);
  return value;
}

function deadline(value: number, label: string): number {
  count(value, 1, label);
  if (value > 2_147_483_647) throw new RangeError(`Invalid ${label}`);
  return value;
}

function abortError(): Error {
  return new DOMException('Invocation aborted before dispatch', 'AbortError');
}

export class ServiceHost {
  #services = new Map<string, OwnedService>();
  #sessions = new Map<SessionId, SessionRow>();
  #starting = new Set<Promise<CreatedSession>>();
  #stopping = new Map<SessionId, Stop>();
  #shutdown: Promise<void> | undefined;
  #maxSessions: number;
  #maxWaiting: number;
  #waitMs: number;
  #drainMs: number;
  #worker: StartOptions;

  constructor(services: readonly OwnedService[], options: ServiceHostOptions = {}) {
    this.#maxSessions = count(options.maxSessions ?? 16, 1, 'session limit');
    this.#maxWaiting = count(options.maxWaiting ?? 8, 0, 'waiting limit');
    this.#waitMs = deadline(options.waitMs ?? 2000, 'waiting deadline');
    this.#drainMs = deadline(options.drainMs ?? 2000, 'drain deadline');
    this.#worker = { ...options.worker, env: { ...options.worker?.env } };
    for (const value of [this.#worker.startupMs, this.#worker.callMs, this.#worker.terminationGraceMs]) {
      if (value !== undefined) deadline(value, 'worker deadline');
    }
    const port = this.#worker.port;
    if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535)) {
      throw new RangeError('Invalid worker port');
    }
    for (const service of services) {
      if (!service.name.length || this.#services.has(service.name)) {
        throw new RangeError(`Invalid or duplicate service name: ${service.name}`);
      }
      this.#services.set(service.name, service);
    }
  }

  get workerPids(): number[] {
    return [
      ...[...this.#sessions.values()].map(row => row.app.pid),
      ...[...this.#stopping.values()].map(stop => stop.app.pid),
    ];
  }

  create(name: string): Promise<CreatedSession> {
    if (this.#shutdown) return Promise.reject(new ServiceLookupError('Service host is shutting down'));
    const service = this.#services.get(name);
    if (!service) return Promise.reject(new ServiceLookupError('Service not found'));
    if (this.#sessions.size + this.#starting.size + this.#stopping.size >= this.#maxSessions) {
      return Promise.reject(new ServiceLimitError('Session limit reached'));
    }
    const completion = Promise.withResolvers<CreatedSession>();
    this.#starting.add(completion.promise);
    void this.#start(service, completion.promise).then(completion.resolve, completion.reject);
    void completion.promise.then(
      () => this.#starting.delete(completion.promise),
      () => this.#starting.delete(completion.promise),
    );
    return completion.promise;
  }

  async #start(service: OwnedService, reservation: Promise<CreatedSession>): Promise<CreatedSession> {
    const app = await service.start(this.#worker);
    const sessionId = sessionIdSchema.parse(randomUUID());
    const row: SessionRow = { sessionId, service, app, phase: { kind: 'idle' }, waiting: [] };
    // Transfer the reservation without yielding, so admission never loses ownership.
    this.#sessions.set(sessionId, row);
    if (this.#shutdown) {
      await this.#stop(row, new ServiceLookupError('Service host is shutting down'));
      throw new ServiceLookupError('Service host is shutting down');
    }
    this.#starting.delete(reservation);
    return { sessionId, service: service.name };
  }

  async invoke<Args, Reply>(
    service: Service<Args, Reply>, sessionId: SessionId, args: NoInfer<Args>,
    options: InvocationOptions = {},
  ): Promise<Reply> {
    const input = service.args.parse(args);
    const row = this.#sessions.get(sessionId);
    if (this.#shutdown || this.#services.get(service.name) !== service || !row || row.service !== service) {
      throw new ServiceLookupError('Session not found for this service');
    }
    if (options.signal?.aborted) throw abortError();
    this.#prune(row);
    if (row.phase.kind !== 'idle' && row.waiting.length >= this.#maxWaiting) {
      throw new ServiceLimitError('Session waiting limit reached');
    }
    const job: Job = {
      input, expiresAt: performance.now() + this.#waitMs, signal: options.signal,
      completion: Promise.withResolvers<unknown>(), disposeWaitingHooks: () => {},
    };
    if (row.phase.kind === 'idle') {
      this.#dispatch(row, job);
    } else {
      row.waiting.push(job);
      const timer = setTimeout(() => this.#removeWaiting(row, job, new ServiceWaitError('Invocation waiting deadline exceeded')), this.#waitMs);
      const abort = () => this.#removeWaiting(row, job, abortError());
      job.signal?.addEventListener('abort', abort, { once: true });
      job.disposeWaitingHooks = () => {
        clearTimeout(timer);
        job.signal?.removeEventListener('abort', abort);
      };
      if (job.signal?.aborted) abort();
    }
    return service.reply.parse(await job.completion.promise);
  }

  #removeWaiting(row: SessionRow, job: Job, error: Error): void {
    const index = row.waiting.indexOf(job);
    if (index < 0) return;
    row.waiting.splice(index, 1);
    job.disposeWaitingHooks();
    job.completion.reject(error);
  }

  #prune(row: SessionRow): void {
    const now = performance.now();
    for (const job of [...row.waiting]) {
      if (job.signal?.aborted) this.#removeWaiting(row, job, abortError());
      else if (job.expiresAt <= now) {
        this.#removeWaiting(row, job, new ServiceWaitError('Invocation waiting deadline exceeded'));
      }
    }
  }

  #pump(row: SessionRow): void {
    if (row.phase.kind !== 'idle') return;
    this.#prune(row);
    const next = row.waiting.shift();
    if (next) this.#dispatch(row, next);
  }

  #dispatch(row: SessionRow, job: Job): void {
    job.disposeWaitingHooks();
    if (job.signal?.aborted || job.expiresAt <= performance.now()) {
      job.completion.reject(job.signal?.aborted
        ? abortError()
        : new ServiceWaitError('Invocation waiting deadline exceeded'));
      this.#pump(row);
      return;
    }
    const settled = Promise.withResolvers<void>();
    row.phase = { kind: 'active', job, settled: settled.promise };
    void this.#run(row, job, settled.resolve);
  }

  async #run(row: SessionRow, job: Job, settle: () => void): Promise<void> {
    try {
      job.completion.resolve(await row.app.command(job.input));
    } catch (cause) {
      job.completion.reject(cause);
      const error = new WorkerError('UNAVAILABLE', 'Service session failed', { cause });
      void this.#stop(row, error).catch(() => {});
    } finally {
      if (row.phase.kind === 'active' && row.phase.job === job) {
        row.phase = { kind: 'idle' };
        this.#pump(row);
      }
      settle();
    }
  }

  closeSession(sessionId: SessionId): Promise<void> {
    const stopping = this.#stopping.get(sessionId);
    if (stopping) return stopping.completion;
    const row = this.#sessions.get(sessionId);
    return row ? this.#stop(row, new ServiceLookupError('Session is shutting down')) : Promise.resolve();
  }

  #stop(row: SessionRow, error: Error): Promise<void> {
    if (row.phase.kind === 'closing') return row.phase.completion;
    const active = row.phase.kind === 'active' ? row.phase.settled : Promise.resolve();
    const completion = Promise.withResolvers<void>();
    row.phase = { kind: 'closing', completion: completion.promise };
    this.#sessions.delete(row.sessionId);
    this.#stopping.set(row.sessionId, { app: row.app, completion: completion.promise });
    for (const job of row.waiting.splice(0)) {
      job.disposeWaitingHooks();
      job.completion.reject(error);
    }
    void this.#finishStop(row.app, active).then(completion.resolve, completion.reject);
    void completion.promise.then(
      () => this.#stopping.delete(row.sessionId),
      () => {},
    );
    return completion.promise;
  }

  async #finishStop(app: OwnedApp, active: Promise<void>): Promise<void> {
    const expired = Promise.withResolvers<void>();
    const timer = setTimeout(expired.resolve, this.#drainMs);
    try {
      await Promise.race([active, expired.promise]);
    } finally {
      clearTimeout(timer);
    }
    await app.close();
  }

  close(): Promise<void> {
    if (this.#shutdown) return this.#shutdown;
    const completion = Promise.withResolvers<void>();
    this.#shutdown = completion.promise;
    void this.#closeAll().then(completion.resolve, completion.reject);
    return completion.promise;
  }

  async #closeAll(): Promise<void> {
    for (const row of this.#sessions.values()) {
      void this.#stop(row, new ServiceLookupError('Service host is shutting down')).catch(() => {});
    }
    await Promise.allSettled([...this.#starting]);
    const results = await Promise.allSettled([...this.#stopping.values()].map(stop => stop.completion));
    const failures = results.filter(result => result.status === 'rejected').map(result => result.reason);
    if (failures.length) throw new AggregateError(failures, 'Service session cleanup failed');
  }
}
