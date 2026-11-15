import type { TestContext } from 'node:test';
import { startAppGateway } from '../../src/gateway.ts';
import { startSessionGateway } from '../../src/server.ts';
import { bounded } from './deadlines.ts';
import { assertGone, cleanupPriority, resources } from './resources.ts';

export async function gateway(t: TestContext, options: Parameters<typeof startAppGateway>[0] = {}) {
  const server = await startAppGateway(options);
  resources(t).add(cleanupPriority.native, async () => {
    const pids = server.workerPids;
    await bounded(server.close(), 5000);
    pids.forEach(assertGone);
  });
  return server;
}

export async function sessionGateway(t: TestContext, options: Parameters<typeof startSessionGateway>[0] = {}) {
  const server = await startSessionGateway(options);
  resources(t).add(cleanupPriority.native, async () => {
    await bounded(server.close(), 5000);
    assertGone(server.workerPid);
  });
  return server;
}
