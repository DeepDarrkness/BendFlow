import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import test, { type TestContext } from 'node:test';
import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import type { ContractRouterClient } from '@orpc/contract';
import { z } from 'zod';
import { sessionContract, commandSchema, replySchema } from '../contracts/session.ts';
import { startSessionGateway } from '../src/server.ts';
import { assertGone, bounded } from './helpers.ts';
import { sessionStub } from './session-stub.ts';

const execute = promisify(execFile);

function client(url: string): ContractRouterClient<typeof sessionContract> {
  return createORPCClient(new RPCLink({ url, fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(3000) }) }));
}

async function gateway(t: TestContext) {
  const server = await startSessionGateway();
  t.after(async () => { await bounded(server.close()); assertGone(server.workerPid); });
  return server;
}

test('separate client process makes repeated stateful HTTP calls to native BendRT', async t => {
  const server = await gateway(t);
  const { stdout, stderr } = await execute(process.execPath, [resolve('examples/session-client.ts'), server.url], {
    timeout: 10_000, killSignal: 'SIGKILL', maxBuffer: 16384,
  });
  assert.equal(stderr, '');
  const lineSchema = z.strictObject({ clientPid: z.number().int(), command: commandSchema, result: replySchema });
  const rows = stdout.trim().split('\n').map(line => lineSchema.parse(JSON.parse(line)));
  assert.equal(rows.length, 6);
  assert.ok(rows.every(row => row.clientPid !== process.pid && row.clientPid !== server.workerPid));
  assert.equal(new Set(rows.map(row => row.clientPid)).size, 1);
  assert.deepEqual(rows.slice(0, 3).map(row => row.result), [
    { kind: 'value', value: { total: 7, acceptedAdds: 1 } },
    { kind: 'value', value: { total: 14, acceptedAdds: 2 } },
    { kind: 'value', value: { total: 21, acceptedAdds: 3 } },
  ]);
  assert.deepEqual(await client(server.url).command({ kind: 'read' }), { kind: 'value', value: { total: 5, acceptedAdds: 1 } });
});

test('multiple external clients interact with the same native session', async t => {
  const server = await gateway(t);
  const first = client(server.url);
  const second = client(server.url);
  assert.deepEqual(await first.command({ kind: 'add', amount: 7 }), { kind: 'value', value: { total: 7, acceptedAdds: 1 } });
  assert.deepEqual(await second.command({ kind: 'add', amount: 7 }), { kind: 'value', value: { total: 14, acceptedAdds: 2 } });
  assert.deepEqual(await first.command({ kind: 'read' }), { kind: 'value', value: { total: 14, acceptedAdds: 2 } });
});

test('HTTP validation rejects unsupported commands before changing state', async t => {
  const server = await gateway(t);
  await client(server.url).command({ kind: 'add', amount: 7 });
  for (const json of [{ kind: 'add' }, { kind: 'add', amount: -1 }, { kind: 'add', amount: 1.5 },
    { kind: 'add', amount: 0x100000000 }, { kind: 'add', amount: 7, extra: true }, { kind: 'eval', source: 'code' },
    { kind: 'reset', extra: true }]) {
    const response = await fetch(`${server.url}/command`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ json }),
      signal: AbortSignal.timeout(3000),
    });
    assert.equal(response.status, 400);
    await response.text();
  }
  assert.deepEqual(await client(server.url).command({ kind: 'read' }), { kind: 'value', value: { total: 7, acceptedAdds: 1 } });
});

test('HTTP overflow is a typed result that preserves state', async t => {
  const server = await gateway(t);
  const remote = client(server.url);
  await remote.command({ kind: 'add', amount: 0xffffffff });
  assert.deepEqual(await remote.command({ kind: 'add', amount: 1 }), { kind: 'overflow', value: { total: 0xffffffff, acceptedAdds: 1 } });
  assert.deepEqual(await remote.command({ kind: 'read' }), { kind: 'value', value: { total: 0xffffffff, acceptedAdds: 1 } });
});

test('HTTP body size is limited and failed input leaves state unchanged', async t => {
  const server = await gateway(t);
  const response = await fetch(`${server.url}/command`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ json: { kind: 'add', amount: 7, extra: 'x'.repeat(2048) } }),
    signal: AbortSignal.timeout(3000),
  });
  assert.equal(response.status, 413);
  await response.text();
  assert.deepEqual(await client(server.url).command({ kind: 'read' }), { kind: 'value', value: { total: 0, acceptedAdds: 0 } });
});

test('dead native session produces a bounded HTTP infrastructure error', async t => {
  const server = await gateway(t);
  const remote = client(server.url);
  await remote.command({ kind: 'add', amount: 7 });
  process.kill(server.workerPid, 'SIGKILL');
  await assert.rejects(bounded(remote.command({ kind: 'add', amount: 7 })), error => {
    assert.ok(error instanceof Error && 'code' in error);
    assert.equal(error.code, 'SERVICE_UNAVAILABLE');
    return true;
  });
});

test('HTTP busy/deadline errors never replay a command whose response was withheld', async t => {
  const stub = await sessionStub(t);
  const server = await startSessionGateway({ worker: stub.worker });
  t.after(async () => { await bounded(server.close()); assertGone(server.workerPid); });
  const remote = client(server.url);
  const pending = remote.command({ kind: 'add', amount: 7 });
  const deadline = assert.rejects(pending, error => {
    assert.ok(error instanceof Error && 'code' in error);
    assert.equal(error.code, 'GATEWAY_TIMEOUT');
    return true;
  });
  await bounded(stub.arrived);
  await assert.rejects(remote.command({ kind: 'add', amount: 7 }), error => {
    assert.ok(error instanceof Error && 'code' in error);
    assert.equal(error.code, 'TOO_MANY_REQUESTS');
    return true;
  });
  await bounded(deadline);
  await assert.rejects(remote.command({ kind: 'read' }), error => {
    assert.ok(error instanceof Error && 'code' in error);
    assert.equal(error.code, 'SERVICE_UNAVAILABLE');
    return true;
  });
  assert.equal(stub.commands.length, 1);
  await bounded(server.close());
  assertGone(server.workerPid);
});

test('concurrent gateway shutdown calls reject an active HTTP request and reap its worker', async t => {
  const stub = await sessionStub(t);
  const server = await startSessionGateway({ worker: stub.worker });
  t.after(() => bounded(server.close()));
  const rejected = assert.rejects(client(server.url).command({ kind: 'add', amount: 7 }));
  await bounded(stub.arrived);
  const first = server.close();
  assert.equal(first, server.close());
  await bounded(first);
  await bounded(rejected);
  assertGone(server.workerPid);
  assert.equal(stub.commands.length, 1);
});
