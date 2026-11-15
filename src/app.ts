import { BendWorker, WorkerError, type WorkerOptions } from './worker.ts';

export const COMMAND_OPERATION = 1;

export type AppCodec<Command, Reply> = {
  contract: string;
  parse: (input: unknown) => Command;
  encode: (command: Command) => Buffer;
  decode: (payload: Buffer) => Reply;
};

export function validatedCodec<Command, Reply>(
  codec: AppCodec<Command, Reply>, reply: { parse: (input: unknown) => Reply },
): AppCodec<Command, Reply> {
  return {
    ...codec,
    encode: command => codec.encode(codec.parse(command)),
    decode: payload => reply.parse(codec.decode(payload)),
  };
}

export class NativeApp<Command, Reply> {
  #worker: BendWorker;
  #codec: AppCodec<Command, Reply>;
  #closing: Promise<void> | undefined;

  private constructor(worker: BendWorker, codec: AppCodec<Command, Reply>) {
    this.#worker = worker;
    this.#codec = codec;
  }

  static async start<Command, Reply>(
    codec: AppCodec<Command, Reply>,
    options: Omit<WorkerOptions, 'contract'>,
  ): Promise<NativeApp<Command, Reply>> {
    return new NativeApp(await BendWorker.start({ ...options, contract: codec.contract }), codec);
  }

  get pid(): number { return this.#worker.pid; }

  get diagnostics(): string { return this.#worker.diagnostics; }

  async command(command: Command): Promise<Reply> {
    if (this.#closing) throw new WorkerError('CLOSED', 'Session is shutting down');
    const payload = this.#codec.encode(this.#codec.parse(command));
    const response = await this.#worker.call(COMMAND_OPERATION, payload);
    try { return this.#codec.decode(response); }
    catch (error) {
      await this.#worker.close();
      throw new WorkerError('PROTOCOL', 'Malformed native session response', { cause: error });
    }
  }

  raw(payload: Uint8Array): Promise<Buffer> {
    if (this.#closing) return Promise.reject(new WorkerError('CLOSED', 'Session is shutting down'));
    return this.#worker.call(COMMAND_OPERATION, payload);
  }

  close(): Promise<void> {
    this.#closing ??= this.#worker.shutdown();
    return this.#closing;
  }
}
