import { createServer } from 'node:http';
import { implement, ORPCError } from '@orpc/server';
import { RPCHandler, BodyLimitPlugin } from '@orpc/server/node';
import { appsContract } from '../contracts/apps.ts';
import { numericReplySchema } from '../contracts/numeric.ts';
import { collectionReplySchema } from '../contracts/collection.ts';
import { fileReplySchema } from '../contracts/file.ts';
import { networkReplySchema } from '../contracts/network.ts';
import { taskReplySchema } from '../contracts/task.ts';
import { processReplySchema } from '../contracts/process.ts';
import { computeReplySchema } from '../contracts/compute.ts';
import { customReplySchema } from '../contracts/custom.ts';
import { AppSessions, SessionLookupError, SessionLimitError } from './apps.ts';
import { capabilities } from './kinds.ts';
import { WorkerError } from './worker.ts';
import { byteSerializer } from './protocol/json.ts';

async function rpc<Result>(action: () => Promise<Result>): Promise<Result> {
  try { return await action(); }
  catch (error) {
    if (error instanceof SessionLookupError) throw new ORPCError('NOT_FOUND', { message: error.message });
    if (error instanceof SessionLimitError) throw new ORPCError('TOO_MANY_REQUESTS', { message: error.message });
    if (!(error instanceof WorkerError)) throw error;
    if (error.code === 'BUSY') throw new ORPCError('TOO_MANY_REQUESTS', { message: error.message });
    if (error.code === 'DEADLINE') throw new ORPCError('GATEWAY_TIMEOUT', { message: error.message });
    throw new ORPCError('SERVICE_UNAVAILABLE', { message: error.message });
  }
}

export async function startAppGateway(options: ConstructorParameters<typeof AppSessions>[0] & { port?: number } = {}) {
  const sessions = new AppSessions(options);
  const impl = implement(appsContract);
  const router = impl.router({
    sessions: {
      create: impl.sessions.create.handler(({ input }) => rpc(() => sessions.create(input))),
      close: impl.sessions.close.handler(({ input }) => rpc(async () => {
        await sessions.closeSession(input.sessionId);
        return { kind: 'ok' as const };
      })),
    },
    numeric: { command: impl.numeric.command.handler(({ input }) => rpc(() => sessions.command('numeric', input.sessionId, input.command, numericReplySchema))) },
    collection: { command: impl.collection.command.handler(({ input }) => rpc(() => sessions.command('collection', input.sessionId, input.command, collectionReplySchema))) },
    file: { command: impl.file.command.handler(({ input }) => rpc(() => sessions.command('file', input.sessionId, input.command, fileReplySchema))) },
    network: { command: impl.network.command.handler(({ input }) => rpc(() => sessions.command('network', input.sessionId, input.command, networkReplySchema))) },
    task: { command: impl.task.command.handler(({ input }) => rpc(() => sessions.command('task', input.sessionId, input.command, taskReplySchema))) },
    process: { command: impl.process.command.handler(({ input }) => rpc(() => sessions.command('process', input.sessionId, input.command, processReplySchema))) },
    compute: { command: impl.compute.command.handler(({ input }) => rpc(() => sessions.command('compute', input.sessionId, input.command, computeReplySchema))) },
    custom: { command: impl.custom.command.handler(({ input }) => rpc(() => sessions.command('custom', input.sessionId, input.command, customReplySchema))) },
  });
  const handler = new RPCHandler(router, {
    plugins: [new BodyLimitPlugin({ maxBodySize: 4096 })], customJsonSerializers: [byteSerializer],
  });
  const server = createServer((request, response) => {
    if (request.method === 'GET' && request.url === '/capabilities') {
      response.setHeader('content-type', 'application/json');
      const available = capabilities();
      const hardware = sessions.gpuHardware;
      response.end(JSON.stringify({
        ...available,
        profiles: available.profiles.map(row => row.profile === 'gpu' && hardware?.status === 'verified'
          ? { profile: 'gpu', status: 'available', scope: 'sessions', kinds: ['compute'], evidence: hardware.report }
          : row.profile === 'gpu' && hardware
            ? { ...row, reason: 'Configured GPU hardware evidence is not verified' }
            : row),
        ...(hardware ? { hardware } : {}),
      }));
      return;
    }
    void handler.handle(request, response, { prefix: '/rpc' }).then(({ matched }) => {
      if (!matched) { response.statusCode = 404; response.end('Not found'); }
    }).catch(() => {
      if (!response.headersSent) response.statusCode = 500;
      response.end();
    });
  });
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(options.port ?? 0, '127.0.0.1', resolve);
    });
  } catch (error) { await sessions.close(); throw error; }
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected an IPv4 gateway');
  let cleanup: Promise<void> | undefined;
  return {
    url: `http://127.0.0.1:${address.port}/rpc`,
    origin: `http://127.0.0.1:${address.port}`,
    get workerPids() { return sessions.workerPids; },
    close(): Promise<void> {
      cleanup ??= (async () => {
        const stopped = new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
        server.closeAllConnections();
        await Promise.all([sessions.close(), stopped]);
      })();
      return cleanup;
    },
  };
}
