import { commandSchema, type Command, type SessionReply } from '../contracts/session.ts';
import { decodeReply, encodeCommand, SESSION_CONTRACT, STEP_OPERATION } from './protocol/session.ts';
import { BendWorker, WorkerError, type WorkerOptions } from './worker.ts';

export class NativeSession {
  #worker: BendWorker;

  private constructor(worker: BendWorker) { this.#worker = worker; }

  static async start(options: Omit<WorkerOptions, 'contract'>): Promise<NativeSession> {
    return new NativeSession(await BendWorker.start({ ...options, contract: SESSION_CONTRACT }));
  }

  get pid(): number { return this.#worker.pid; }

  async command(command: Command): Promise<SessionReply> {
    const payload = encodeCommand(commandSchema.parse(command));
    const response = await this.#worker.call(STEP_OPERATION, payload);
    try { return decodeReply(response); }
    catch (error) {
      await this.#worker.close();
      throw new WorkerError('PROTOCOL', 'Malformed native session response', { cause: error });
    }
  }

  close(): Promise<void> { return this.#worker.close(); }
}
