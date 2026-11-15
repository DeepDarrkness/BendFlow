import { spawn, type ChildProcess } from 'node:child_process';
import { createConnection, createServer, type Socket } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { CONTRACT, ECHO_OPERATION, MAX_PAYLOAD, encodeFrame, FrameDecoder, ProtocolError, type Frame } from './protocol/framing.ts';
import { CPU_ARGS, type ExecutionProfile, runtimeArgs } from './runtime.ts';

export class WorkerError extends Error {
  readonly code: 'STARTUP' | 'UNAVAILABLE' | 'BUSY' | 'DEADLINE' | 'PROTOCOL' | 'CLOSED';

  constructor(code: WorkerError['code'], message: string, options?: ErrorOptions) {
    super(message, options);
    this.code = code;
  }
}

export type WorkerOptions = {
  executable: string;
  port?: number;
  startupMs?: number;
  callMs?: number;
  terminationGraceMs?: number;
  contract?: string;
  profile?: ExecutionProfile;
  threads?: number;
  env?: NodeJS.ProcessEnv;
};

export async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected an IPv4 port');
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return address.port;
}

type Pending = {
  requestId: number;
  operationId: number;
  kind: 2 | 4;
  resolve: (frame: Frame) => void;
  reject: (error: Error) => void;
};

export class BendWorker {
  #child: ChildProcess;
  #socket: Socket | undefined;
  #decoder = new FrameDecoder();
  #pending: Pending | undefined;
  #state: 'starting' | 'ready' | 'busy' | 'failed' | 'closed' = 'starting';
  #failure: Error | undefined;
  #nextId = 1;
  #options: Required<WorkerOptions>;
  #exited = Promise.withResolvers<void>();
  #cleanup: Promise<void> | undefined;
  #shutdown: Promise<void> | undefined;
  #abort = new AbortController();
  #diagnostics = Buffer.alloc(0);

  private constructor(options: Required<WorkerOptions>) {
    this.#options = options;
    this.#child = spawn(options.executable, [...runtimeArgs(options.profile, options.threads), String(options.port)], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...options.env, BENDRTS: '', BEND_NO_TELEMETRY: '1' },
    });
    const drain = (chunk: Buffer) => {
      this.#diagnostics = Buffer.concat([this.#diagnostics, chunk]).subarray(-8192);
    };
    this.#child.stdout?.on('data', drain);
    this.#child.stderr?.on('data', drain);
    this.#child.on('error', error => this.#fail(new WorkerError('STARTUP', 'Worker launch failed', { cause: error })));
    this.#child.once('close', (code, signal) => {
      this.#exited.resolve();
      this.#fail(new WorkerError('UNAVAILABLE', `Worker exited (${signal ?? code}): ${this.diagnostics}`));
    });
  }

  static async start(options: WorkerOptions): Promise<BendWorker> {
    const config = {
      executable: options.executable, port: options.port ?? await availablePort(),
      startupMs: options.startupMs ?? 10_000, callMs: options.callMs ?? 2000,
      terminationGraceMs: options.terminationGraceMs ?? 100,
      contract: options.contract ?? CONTRACT.toString('ascii'),
      profile: options.profile ?? 'native-cpu',
      threads: options.threads ?? 2,
      env: options.env ?? {},
    };
    if (!/^[\x20-\x7e]+$/.test(config.contract) || config.contract.length > MAX_PAYLOAD) throw new RangeError('Invalid worker contract');
    if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) throw new RangeError('Invalid worker port');
    for (const value of [config.startupMs, config.callMs, config.terminationGraceMs]) {
      if (!Number.isInteger(value) || value <= 0 || value > 2_147_483_647) throw new RangeError('Invalid worker deadline');
    }
    const worker = new BendWorker(config);
    const timer = setTimeout(() => worker.#fail(new WorkerError('STARTUP', 'Worker startup deadline exceeded')), config.startupMs);
    try {
      await worker.#connect();
      const contract = Buffer.from(config.contract, 'ascii');
      const response = await worker.#exchange({ kind: 1, requestId: 0, operationId: 0, payload: contract }, 2);
      if (!response.payload.equals(contract)) throw new ProtocolError('Incompatible worker contract');
      if (worker.#failure) throw worker.#failure;
      worker.#state = 'ready';
      return worker;
    } catch (error) {
      worker.#fail(error instanceof Error ? error : new Error(String(error)));
      await worker.close();
      throw worker.#failure;
    } finally {
      clearTimeout(timer);
    }
  }

  get pid(): number {
    const pid = this.#child.pid;
    if (pid === undefined) throw new WorkerError('UNAVAILABLE', 'Worker has no PID');
    return pid;
  }

  get diagnostics(): string { return this.#diagnostics.toString('utf8'); }

  async #connect(): Promise<void> {
    while (!this.#failure) {
      const socket = createConnection({ host: '127.0.0.1', port: this.#options.port });
      this.#socket = socket;
      const connected = await new Promise<boolean>(resolve => {
        socket.once('connect', () => resolve(true));
        socket.once('error', () => resolve(false));
        socket.once('close', () => resolve(false));
      });
      if (this.#failure) throw this.#failure;
      if (connected) {
        socket.setNoDelay(true);
        socket.on('error', error => this.#fail(new WorkerError('UNAVAILABLE', 'Worker socket failed', { cause: error })));
        socket.on('data', chunk => {
          try { this.#decoder.push(chunk, frame => this.#response(frame)); }
          catch (error) { this.#fail(new WorkerError('PROTOCOL', 'Invalid worker response', { cause: error })); }
        });
        socket.on('end', () => {
          try { this.#decoder.finish(); }
          catch (error) { this.#fail(new WorkerError('PROTOCOL', 'Truncated worker response', { cause: error })); }
          this.#fail(new WorkerError('UNAVAILABLE', 'Worker disconnected'));
        });
        socket.on('close', () => this.#fail(new WorkerError('UNAVAILABLE', 'Worker connection closed')));
        return;
      }
      socket.destroy();
      await delay(20, undefined, { signal: this.#abort.signal });
    }
    throw this.#failure;
  }

  #response(frame: Frame): void {
    const pending = this.#pending;
    if (!pending || frame.kind !== pending.kind || frame.requestId !== pending.requestId || frame.operationId !== pending.operationId) {
      throw new ProtocolError('Unexpected message kind, request ID, or operation ID');
    }
    this.#pending = undefined;
    pending.resolve(frame);
  }

  #exchange(frame: Frame, kind: 2 | 4): Promise<Frame> {
    if (this.#failure) return Promise.reject(this.#failure);
    const bytes = encodeFrame(frame);
    const result = Promise.withResolvers<Frame>();
    this.#pending = { requestId: frame.requestId, operationId: frame.operationId, kind, resolve: result.resolve, reject: result.reject };
    this.#socket?.write(bytes, error => {
      if (error) this.#fail(new WorkerError('UNAVAILABLE', 'Worker write failed', { cause: error }));
    });
    return result.promise;
  }

  echo(payload: Uint8Array): Promise<Buffer> {
    return this.call(ECHO_OPERATION, payload);
  }

  async call(operationId: number, payload: Uint8Array): Promise<Buffer> {
    if (this.#state === 'busy') throw new WorkerError('BUSY', 'Worker is busy');
    if (this.#state !== 'ready') throw new WorkerError('UNAVAILABLE', 'Worker is unavailable', { cause: this.#failure });
    if (payload.byteLength > MAX_PAYLOAD) throw new ProtocolError('Frame exceeds 256-byte body limit');
    const frame: Frame = { kind: 3, requestId: this.#nextId, operationId, payload: Buffer.from(payload) };
    encodeFrame(frame);
    this.#nextId = this.#nextId === 0xffffffff ? 1 : this.#nextId + 1;
    this.#state = 'busy';
    const timer = setTimeout(() => this.#fail(new WorkerError('DEADLINE', 'Worker call deadline exceeded')), this.#options.callMs);
    try {
      const response = await this.#exchange(frame, 4);
      if (this.#failure) throw this.#failure;
      if (this.#socket?.destroyed) throw new WorkerError('CLOSED', 'Worker is shutting down');
      this.#state = 'ready';
      return response.payload;
    } finally {
      clearTimeout(timer);
    }
  }

  #fail(error: Error): void {
    if (this.#state === 'closed' || this.#failure) return;
    this.#failure = error;
    this.#state = 'failed';
    this.#abort.abort();
    this.#pending?.reject(error);
    this.#pending = undefined;
    this.#socket?.destroy();
    void this.close().catch(cleanupError => {
      this.#diagnostics = Buffer.from(`${this.diagnostics}\nCleanup failed: ${cleanupError}`).subarray(-8192);
    });
  }

  close(): Promise<void> {
    this.#cleanup ??= this.#terminate();
    return this.#cleanup;
  }

  shutdown(): Promise<void> {
    this.#shutdown ??= this.#gracefulShutdown();
    return this.#shutdown;
  }

  async #gracefulShutdown(): Promise<void> {
    if (this.#state === 'ready') {
      const timer = setTimeout(() => { void this.close().catch(() => {}); }, this.#options.terminationGraceMs);
      try {
        const reply = await this.call(3, Buffer.alloc(0));
        if (!reply.equals(Buffer.from([0]))) throw new ProtocolError('Invalid shutdown acknowledgement');
        await this.#waitForExit(this.#options.terminationGraceMs);
      } catch {
        // A missing acknowledgement leaves completion uncertain; terminate without replay.
      } finally { clearTimeout(timer); }
    }
    await this.close();
  }

  async #terminate(): Promise<void> {
    this.#state = 'closed';
    this.#abort.abort();
    this.#pending?.reject(new WorkerError('CLOSED', 'Worker is shutting down'));
    this.#pending = undefined;
    this.#socket?.destroy();
    const child = this.#child;
    if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) {
      if (!await this.#waitForExit(1000)) throw new Error('Worker pipes did not close after exit');
      return;
    }
    child.kill('SIGTERM');
    if (!await this.#waitForExit(this.#options.terminationGraceMs)) {
      child.kill('SIGKILL');
      if (!await this.#waitForExit(1000)) throw new Error('Worker did not exit after SIGKILL');
    }
  }

  async #waitForExit(ms: number): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        this.#exited.promise.then(() => true),
        new Promise<false>(resolve => { timer = setTimeout(() => resolve(false), ms); }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
