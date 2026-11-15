import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { z } from 'zod';
import { sessionIdSchema, sessionKindSchema } from '../../contracts/apps.ts';
import { createAppClient as client } from '../../src/client.ts';
import { SESSION_KINDS } from '../../src/kinds.ts';
import { projectPath } from '../../src/paths.ts';
import { assertGone, scratch } from '../support/resources.ts';
import { bounded } from '../support/deadlines.ts';
import { gateway } from '../support/gateways.ts';
import { external as execute } from '../support/subprocess.ts';
const rowSchema = z.strictObject({ clientPid: z.number().int(), sessionId: sessionIdSchema, kind: sessionKindSchema, reply: z.unknown() });

async function external(url: string, kind: string, path: string, sessionId?: string, resourceId?: number) {
  const args = [projectPath('tests/fixtures/app-client.ts'), url, kind, path];
  if (sessionId !== undefined && resourceId !== undefined) args.push(sessionId, String(resourceId));
  const { stdout, stderr } = await execute(process.execPath, args, { timeout: 10_000, killSignal: 'SIGKILL', maxBuffer: 16384 });
  assert.equal(stderr, '');
  const rows = stdout.trim().split('\n').map(line => rowSchema.parse(JSON.parse(line)));
  assert.ok(rows.every(row => row.clientPid !== process.pid));
  return rows;
}

test('capabilities distinguish available execution profiles from unverified hardware', async t => {
  const server = await gateway(t);
  const response = await fetch(`${server.origin}/capabilities`);
  const listed = z.strictObject({
    kinds: z.array(z.strictObject({ kind: sessionKindSchema, contract: z.string() })),
    profiles: z.array(z.discriminatedUnion('status', [
      z.strictObject({ profile: z.string(), status: z.literal('available') }),
      z.strictObject({ profile: z.string(), status: z.literal('unavailable'), reason: z.string().min(1) }),
    ])),
  }).parse(await response.json());
  assert.deepEqual(listed.kinds.map(row => row.kind), [...SESSION_KINDS]);
  assert.deepEqual(listed.profiles, [
    { profile: 'native-cpu', status: 'available' },
    { profile: 'multithreaded-cpu', status: 'available' },
    { profile: 'gpu', status: 'unavailable', reason: 'No configured GPU execution instrumentation' },
    { profile: 'graphics-audio', status: 'unavailable', reason: 'No configured display or audio capture fixture' },
  ]);
});

test('HTTP numeric sessions persist across clients and remain isolated', async t => {
  const server = await gateway(t);
  const first = client(server.url);
  const second = client(server.url);
  const { sessionId } = await first.sessions.create({ kind: 'numeric' });
  await first.numeric.command({ sessionId, command: { kind: 'add', amount: 7 } });
  assert.deepEqual(await second.numeric.command({ sessionId, command: { kind: 'read' } }), {
    kind: 'value', value: { nat: '0', total: 7, count: 1, f32Bits: 0 },
  });
  const other = await second.sessions.create({ kind: 'numeric' });
  assert.deepEqual(await second.numeric.command({ sessionId: other.sessionId, command: { kind: 'read' } }), {
    kind: 'value', value: { nat: '0', total: 0, count: 0, f32Bits: 0 },
  });
});

for (const kind of SESSION_KINDS.filter(kind => kind !== 'file')) {
  test(`external client creates, commands, and closes an HTTP ${kind} session`, async t => {
    const server = await gateway(t);
    const dir = await scratch(t, 'bendflow-gateway-');
    const rows = await external(server.url, kind, join(dir, 'marker'));
    assert.ok(rows.length >= 2);
    assert.deepEqual(rows.at(-1)?.reply, { kind: 'ok' });
    assert.equal(server.workerPids.length, 0);
    if (kind === 'numeric') assert.deepEqual(rows[0]?.reply, { kind: 'value', value: { nat: '0', total: 7, count: 1, f32Bits: 0 } });
    if (kind === 'collection') assert.deepEqual(rows[0]?.reply, { kind: 'ok' });
    if (kind === 'network') assert.equal(z.object({ kind: z.string() }).parse(rows[0]?.reply).kind, 'opened');
    if (kind === 'task') assert.deepEqual(rows[0]?.reply, { kind: 'text', text: 'job' });
    if (kind === 'process') assert.deepEqual(rows[0]?.reply, { kind: 'run', code: 0, stdout: 'ok\n', stderr: '' });
    if (kind === 'compute') assert.deepEqual(rows[0]?.reply, { kind: 'pixels', items: [1, 2, 3, 4] });
    if (kind === 'custom') assert.equal(await readFile(join(dir, 'marker'), 'utf8'), 'custom\n');
  });
}

test('external file clients share persistent handles, recover from failure, and close explicitly', async t => {
  const server = await gateway(t);
  const dir = await scratch(t, 'bendflow-http-file-');
  const path = join(dir, 'data');
  const rows = await external(server.url, 'file', path);
  const opened = z.strictObject({ kind: z.literal('opened'), id: z.number().int() }).parse(rows[0]?.reply);
  const sessionId = sessionIdSchema.parse(rows[0]?.sessionId);
  assert.equal(z.object({ kind: z.string() }).parse(rows[1]?.reply).kind, 'fail');
  assert.deepEqual(rows[2]?.reply, { kind: 'ok' });
  assert.equal(await readFile(path, 'utf8'), 'from child');
  const pids = server.workerPids;
  assert.equal(pids.length, 1);
  const observer = await external(server.url, 'file', path, sessionId, opened.id);
  assert.notEqual(observer[0]?.clientPid, rows[0]?.clientPid);
  assert.deepEqual(observer.map(row => row.reply), [
    { kind: 'size', value: 10 }, { kind: 'ok' }, { kind: 'missing' }, { kind: 'ok' },
  ]);
  pids.forEach(assertGone);
  assert.equal(server.workerPids.length, 0);
});

test('HTTP rejects wrong kinds, unknown sessions, malformed commands, and unavailable profiles', async t => {
  const server = await gateway(t);
  const remote = client(server.url);
  const { sessionId } = await remote.sessions.create({ kind: 'numeric' });
  await assert.rejects(remote.collection.command({ sessionId, command: { kind: 'read' } }), { code: 'NOT_FOUND' });
  for (const json of [
    { sessionId, command: { kind: 'add', amount: -1 } },
    { sessionId, command: { kind: 'add', amount: 7, extra: true } },
    { sessionId: 'wrong', command: { kind: 'read' } },
  ]) {
    const response = await fetch(`${server.url}/numeric/command`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ json }),
    });
    assert.equal(response.status, 400);
    await response.text();
  }
  const profile = await fetch(`${server.url}/sessions/create`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ json: { kind: 'compute', execution: { profile: 'gpu' } } }),
  });
  assert.equal(profile.status, 400);
  await profile.text();
  assert.deepEqual(await remote.numeric.command({ sessionId, command: { kind: 'read' } }), {
    kind: 'value', value: { nat: '0', total: 0, count: 0, f32Bits: 0 },
  });
  await remote.sessions.close({ sessionId });
  await remote.sessions.close({ sessionId });
  await assert.rejects(remote.numeric.command({ sessionId, command: { kind: 'read' } }), { code: 'NOT_FOUND' });
});

test('HTTP session admission is bounded and closing frees capacity', async t => {
  const server = await gateway(t, { maxSessions: 1 });
  const remote = client(server.url);
  const first = await remote.sessions.create({ kind: 'numeric' });
  await assert.rejects(remote.sessions.create({ kind: 'file' }), { code: 'TOO_MANY_REQUESTS' });
  const pids = server.workerPids;
  await Promise.all([remote.sessions.close({ sessionId: first.sessionId }), remote.sessions.close({ sessionId: first.sessionId })]);
  pids.forEach(assertGone);
  await remote.sessions.create({ kind: 'file' });
});

test('HTTP binary file contents round-trip and concurrent gateway shutdown reaps retained resources', async t => {
  const server = await gateway(t);
  const remote = client(server.url);
  const dir = await scratch(t, 'bendflow-http-binary-');
  const path = join(dir, 'bytes');
  const { sessionId } = await remote.sessions.create({ kind: 'file' });
  const opened = await remote.file.command({ sessionId, command: { kind: 'open', path, mode: 'w' } });
  if (opened.kind !== 'opened') throw new Error('expected opened');
  const data = new Uint8Array([0, 255, 128, 1]);
  await remote.file.command({ sessionId, command: { kind: 'write', id: opened.id, bytes: data } });
  await remote.file.command({ sessionId, command: { kind: 'close', id: opened.id } });
  const reading = await remote.file.command({ sessionId, command: { kind: 'open', path, mode: 'r' } });
  if (reading.kind !== 'opened') throw new Error('expected opened');
  const got = await remote.file.command({ sessionId, command: { kind: 'read', id: reading.id, max: 192 } });
  if (got.kind !== 'bytes') throw new Error('expected bytes');
  assert.deepEqual([...got.bytes], [...data]);
  assert.deepEqual(await readFile(path), Buffer.from(data));
  const pids = server.workerPids;
  const closing = server.close();
  assert.equal(closing, server.close());
  await bounded(closing);
  pids.forEach(assertGone);
});
