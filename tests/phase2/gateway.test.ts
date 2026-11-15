import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import type { ContractRouterClient } from '@orpc/contract';
import { numericContract } from '../../contracts/numeric.ts';
import { startNumericGateway } from '../../src/gateway.ts';
import { capabilities } from '../../src/kinds.ts';
import { assertGone, bounded } from '../helpers.ts';

function client(url: string): ContractRouterClient<typeof numericContract> {
  return createORPCClient(new RPCLink({ url, fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(3000) }) }));
}

async function gateway(t: TestContext) {
  const server = await startNumericGateway();
  t.after(async () => { await bounded(server.close()); assertGone(server.workerPid); });
  return server;
}

test('capabilities endpoint lists session kinds and required native-cpu profile', async t => {
  const server = await gateway(t);
  const listed = await (await fetch(`${server.origin}/capabilities`)).json();
  assert.deepEqual(listed, capabilities());
  const cpu = listed.profiles.find((row: { profile: string }) => row.profile === 'native-cpu');
  assert.deepEqual(cpu, { profile: 'native-cpu', status: 'verified' });
});

test('HTTP numeric gateway persists state across clients', async t => {
  const server = await gateway(t);
  const first = client(server.url);
  const second = client(server.url);
  await first.command({ kind: 'add', amount: 7 });
  assert.deepEqual(await second.command({ kind: 'read' }), {
    kind: 'value', value: { nat: '0', total: 7, count: 1, f32Bits: 0 },
  });
});
