import assert from 'node:assert/strict';
import test from 'node:test';
import { createConnection, createServer, type Socket } from 'node:net';
import { createSocket } from 'node:dgram';
import { startAppGateway } from '../../src/gateway.ts';
import { createAppClient } from '../../src/client.ts';
import { availablePort } from '../../src/worker.ts';
import { NativeApp } from '../../src/app.ts';
import { networkCodec } from '../../src/protocol/codecs/network.ts';
import { projectPath } from '../../src/paths.ts';
import { networkFixture } from '../fixtures/network/build.ts';
import { bounded } from '../support/deadlines.ts';
import { listen, bindUdp } from '../support/servers.ts';
import { ownNative, resources, cleanupPriority } from '../support/resources.ts';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import type { NetworkReply } from '../../contracts/network.ts';

function id(reply: NetworkReply): number {
  assert.equal(reply.kind, 'opened');
  if (reply.kind !== 'opened') throw new Error('Expected resource ID');
  return reply.id;
}

test('HTTP network listener, accepted streams, fragmented reads, timed writes and close use controlled peers', async t => {
  const gateway = await startAppGateway();
  resources(t).add(cleanupPriority.native, () => gateway.close());
  const first = createAppClient(gateway.url);
  const second = createAppClient(gateway.url);
  const { sessionId } = await first.sessions.create({ kind: 'network' });
  const command = (command: Parameters<typeof first.network.command>[0]['command']) => second.network.command({ sessionId, command });
  const port = await availablePort();
  const listenerId = id(await command({ kind: 'listen', host: '127.0.0.1', port }));
  assert.deepEqual(await command({ kind: 'tryAccept', id: listenerId, ms: 10 }), { kind: 'timeout' });
  for (const acceptKind of ['accept', 'tryAccept'] as const) {
    const peer = createConnection({ host: '127.0.0.1', port, allowHalfOpen: true });
    t.after(() => peer.destroy());
    await bounded(new Promise<void>((resolve, reject) => { peer.once('connect', resolve); peer.once('error', reject); }));
    const socketId = id(await command(acceptKind === 'accept' ? { kind: acceptKind, id: listenerId } : { kind: acceptKind, id: listenerId, ms: 1000 }));
    assert.deepEqual(await command({ kind: 'tryRecv', id: socketId, max: 192, ms: 10 }), { kind: 'timeout' });
    for (const bytes of [Buffer.from([0]), Buffer.from([255, 0xc3]), Buffer.from([0xa9])]) {
      peer.write(bytes);
      assert.deepEqual(await command({ kind: 'tryRecv', id: socketId, max: 192, ms: 1000 }), { kind: 'bytes', bytes: new Uint8Array(bytes) });
    }
    peer.end();
    assert.deepEqual(await command({ kind: 'tryRecv', id: socketId, max: 192, ms: 1000 }), { kind: 'eof' });
    const observed = Promise.withResolvers<Buffer>();
    peer.once('data', bytes => observed.resolve(bytes));
    const bytes = Buffer.alloc(192, 255);
    assert.deepEqual(await command({ kind: 'trySend', id: socketId, bytes, ms: 1000 }), { kind: 'ok' });
    assert.deepEqual(await bounded(observed.promise), bytes);
    assert.deepEqual(await command({ kind: 'tryAccept', id: socketId, ms: 0 }), { kind: 'wrongResource' });
    await command({ kind: 'close', id: socketId });
    assert.deepEqual(await command({ kind: 'tryRecv', id: socketId, max: 1, ms: 0 }), { kind: 'missing' });
  }
  const other = await first.sessions.create({ kind: 'network' });
  assert.deepEqual(await first.network.command({ sessionId: other.sessionId, command: { kind: 'close', id: listenerId } }), { kind: 'missing' });
  for (const malformed of [
    { kind: 'listen', host: 'invalid', port }, { kind: 'tryAccept', id: listenerId, ms: 10001 },
    { kind: 'tryRecv', id: listenerId, max: 193, ms: 0 },
  ]) {
    const response = await fetch(`${gateway.url}/network/command`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ json: { sessionId, command: malformed } }) });
    assert.equal(response.status, 400);
  }
  assert.deepEqual(await command({ kind: 'tryAccept', id: listenerId, ms: 0 }), { kind: 'timeout' });
  await first.sessions.close({ sessionId });
  await listen(t, createServer(), port);
});

test('HTTP network refused and reset effects recover and UDP boundaries expose exact sender metadata', async t => {
  const gateway = await startAppGateway();
  resources(t).add(cleanupPriority.native, () => gateway.close());
  const client = createAppClient(gateway.url);
  const { sessionId } = await client.sessions.create({ kind: 'network' });
  const command = (command: Parameters<typeof client.network.command>[0]['command']) => client.network.command({ sessionId, command });
  assert.equal((await command({ kind: 'connect', host: '127.0.0.1', port: await availablePort() })).kind, 'fail');
  const connected = Promise.withResolvers<Socket>();
  const tcpPort = await listen(t, createServer(socket => connected.resolve(socket)));
  const streamId = id(await command({ kind: 'connect', host: '127.0.0.1', port: tcpPort }));
  (await bounded(connected.promise)).resetAndDestroy();
  assert.equal((await command({ kind: 'tryRecv', id: streamId, max: 1, ms: 1000 })).kind, 'fail');
  const failed = await command({ kind: 'trySend', id: streamId, bytes: Buffer.from([1, 255]), ms: 1000 });
  assert.equal(failed.kind, 'sendFailure');
  if (failed.kind !== 'sendFailure') throw new Error('Expected unsent data');
  assert.deepEqual(failed.unsent, new Uint8Array([1, 255]));
  await command({ kind: 'close', id: streamId });
  const udpPort = await availablePort();
  const udpId = id(await command({ kind: 'bind', host: '127.0.0.1', port: udpPort }));
  const peer = createSocket('udp4');
  await bindUdp(t, peer);
  const rejectedDatagram = await command({ kind: 'trySendTo', id: udpId, host: '255.255.255.255', port: peer.address().port, bytes: Buffer.from([7, 255]), ms: 1000 });
  assert.equal(rejectedDatagram.kind, 'sendFailure');
  if (rejectedDatagram.kind !== 'sendFailure') throw new Error('Expected broadcast rejection');
  assert.deepEqual(rejectedDatagram.unsent, new Uint8Array([7, 255]));
  assert.deepEqual(await command({ kind: 'recvFrom', id: udpId, max: 192, ms: 10 }), { kind: 'timeout' });
  for (const bytes of [Buffer.alloc(0), Buffer.alloc(192, 255)]) {
    await new Promise<void>((resolve, reject) => peer.send(bytes, udpPort, '127.0.0.1', error => error ? reject(error) : resolve()));
    assert.deepEqual(await command({ kind: 'recvFrom', id: udpId, max: 192, ms: 1000 }), { kind: 'dgram', host: '127.0.0.1', port: peer.address().port, bytes: new Uint8Array(bytes) });
  }
  for (const bytes of [Buffer.alloc(0), Buffer.alloc(96, 255)]) {
    const observed = Promise.withResolvers<Buffer>();
    peer.once('message', bytes => observed.resolve(bytes));
    assert.deepEqual(await command({ kind: 'trySendTo', id: udpId, host: '127.0.0.1', port: peer.address().port, bytes, ms: 1000 }), { kind: 'ok' });
    assert.deepEqual(await bounded(observed.promise), bytes);
  }
  await client.sessions.close({ sessionId });
  await bindUdp(t, createSocket('udp4'), udpPort);
});

test('HTTP delayed-read TCP backpressure exposes unsent suffix and resumes exact peer bytes', { timeout: 120000 }, async t => {
  const ready = Promise.withResolvers<Socket>();
  const chunks: Buffer[] = [];
  const eof = Promise.withResolvers<void>();
  const port = await listen(t, createServer(socket => {
    socket.pause();
    socket.on('data', bytes => chunks.push(bytes));
    socket.on('end', () => eof.resolve());
    ready.resolve(socket);
  }));
  const gateway = await startAppGateway();
  resources(t).add(cleanupPriority.native, () => gateway.close());
  const client = createAppClient(gateway.url);
  const { sessionId } = await client.sessions.create({ kind: 'network' });
  const streamId = id(await client.network.command({ sessionId, command: { kind: 'connect', host: '127.0.0.1', port } }));
  const peer = await bounded(ready.promise);
  const bytes = Buffer.from(Array.from({ length: 192 }, (_, index) => index));
  let accepted = 0;
  let unsent: Uint8Array | undefined;
  for (let attempt = 0; attempt < 40000; attempt++) {
    const reply = await client.network.command({ sessionId, command: { kind: 'trySend', id: streamId, bytes, ms: 0 } });
    if (reply.kind === 'ok') { accepted += bytes.length; continue; }
    assert.equal(reply.kind, 'sendTimeout');
    if (reply.kind !== 'sendTimeout') throw new Error('Expected backpressure timeout');
    unsent = reply.unsent;
    assert.ok(unsent.length > 0 && unsent.length <= bytes.length);
    assert.deepEqual(Buffer.from(unsent), bytes.subarray(bytes.length - unsent.length));
    accepted += bytes.length - unsent.length;
    break;
  }
  assert.ok(unsent, 'Must observe real send timeout');
  peer.resume();
  assert.deepEqual(await client.network.command({ sessionId, command: { kind: 'trySend', id: streamId, bytes: unsent, ms: 1000 } }), { kind: 'ok' });
  accepted += unsent.length;
  await client.sessions.close({ sessionId });
  await bounded(eof.promise, 10000);
  const actual = Buffer.concat(chunks);
  assert.equal(actual.length, accepted);
  for (let offset = 0; offset < actual.length; offset += bytes.length) assert.deepEqual(actual.subarray(offset, offset + bytes.length), bytes);
});

test('uncertain native TCP write is externally observed exactly once and NativeApp never replays it', async t => {
  const executable = networkFixture('uncertain');
  const chunks: Buffer[] = [];
  const observed = Promise.withResolvers<void>();
  const eof = Promise.withResolvers<void>();
  const port = await listen(t, createServer(socket => {
    socket.on('data', bytes => { chunks.push(bytes); observed.resolve(); });
    socket.on('end', () => eof.resolve());
  }));
  const session = ownNative(t, await NativeApp.start(networkCodec, { executable, callMs: 100, terminationGraceMs: 100 }));
  const socketId = id(await session.command({ kind: 'connect', host: '127.0.0.1', port }));
  const write = session.command({ kind: 'send', id: socketId, bytes: Buffer.from('one-external-effect') });
  const rejected = assert.rejects(write, { code: 'DEADLINE' });
  await bounded(observed.promise);
  await rejected;
  await assert.rejects(session.command({ kind: 'send', id: socketId, bytes: Buffer.from('one-external-effect') }));
  await session.close();
  await bounded(eof.promise);
  assert.equal(Buffer.concat(chunks).toString(), 'one-external-effect');
});

test('HTTP uncertain native TCP write is externally observed exactly once and gateway never replays it', async t => {
  const executable = networkFixture('uncertain');
  const spawn = childProcess.spawn;
  t.mock.method(childProcess, 'spawn', (file: string, ...args: Parameters<typeof spawn> extends [string, ...infer Rest] ? Rest : never) =>
    spawn(file === projectPath('build/network-worker') ? executable : file, ...args));
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  const chunks: Buffer[] = [];
  const observed = Promise.withResolvers<void>();
  const eof = Promise.withResolvers<void>();
  const port = await listen(t, createServer(socket => {
    socket.on('data', bytes => { chunks.push(bytes); observed.resolve(); });
    socket.on('end', () => eof.resolve());
  }));
  const gateway = await startAppGateway({ worker: { callMs: 100, terminationGraceMs: 100 } });
  resources(t).add(cleanupPriority.native, () => gateway.close());
  const client = createAppClient(gateway.url);
  const { sessionId } = await client.sessions.create({ kind: 'network' });
  const socketId = id(await client.network.command({ sessionId, command: { kind: 'connect', host: '127.0.0.1', port } }));
  const write = client.network.command({ sessionId, command: { kind: 'send', id: socketId, bytes: Buffer.from('one-http-effect') } });
  const rejected = assert.rejects(write, { code: 'GATEWAY_TIMEOUT' });
  await bounded(observed.promise);
  await rejected;
  await assert.rejects(client.network.command({ sessionId, command: { kind: 'send', id: socketId, bytes: Buffer.from('one-http-effect') } }), { code: 'SERVICE_UNAVAILABLE' });
  await client.sessions.close({ sessionId });
  await bounded(eof.promise);
  assert.equal(Buffer.concat(chunks).toString(), 'one-http-effect');
});
