import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { implement, ORPCError } from '@orpc/server';
import { RPCHandler, BodyLimitPlugin } from '@orpc/server/node';
import { sessionContract } from '../contracts/session.ts';
import { NativeSession } from './session.ts';
import { WorkerError, type WorkerOptions } from './worker.ts';

export async function startSessionGateway(options: {
  port?: number;
  worker?: Omit<WorkerOptions, 'contract'>;
} = {}) {
  const session = await NativeSession.start(options.worker ?? { executable: resolve('build/session-worker') });
  const implementation = implement(sessionContract);
  const router = implementation.router({
    command: implementation.command.handler(async ({ input }) => {
      try { return await session.command(input); }
      catch (error) {
        if (!(error instanceof WorkerError)) throw error;
        if (error.code === 'BUSY') throw new ORPCError('TOO_MANY_REQUESTS', { message: error.message });
        if (error.code === 'DEADLINE') throw new ORPCError('GATEWAY_TIMEOUT', { message: error.message });
        throw new ORPCError('SERVICE_UNAVAILABLE', { message: error.message });
      }
    }),
  });
  const handler = new RPCHandler(router, { plugins: [new BodyLimitPlugin({ maxBodySize: 1024 })] });
  const server = createServer((request, response) => {
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
  } catch (error) {
    await session.close();
    throw error;
  }
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected an IPv4 gateway');
  let cleanup: Promise<void> | undefined;
  return {
    url: `http://127.0.0.1:${address.port}/rpc`,
    workerPid: session.pid,
    close(): Promise<void> {
      cleanup ??= (async () => {
        const stopped = new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
        server.closeAllConnections();
        await Promise.all([session.close(), stopped]);
      })();
      return cleanup;
    },
  };
}
