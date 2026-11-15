import assert from 'node:assert/strict';
import { createServer, createConnection, type Socket } from 'node:net';
import { createSocket as createUdp } from 'node:dgram';
import test from 'node:test';
import { app } from '../support/native.ts';
import { projectPath } from '../../src/paths.ts';
import { listen, bindUdp } from '../support/servers.ts';
import { networkCodec } from '../../src/protocol/apps.ts';
import { availablePort } from '../../src/worker.ts';
import { BendWorker } from '../../src/worker.ts';
import { NETWORK_CONTRACT } from '../../src/protocol/apps.ts';
import { ownNative } from '../support/resources.ts';
import { bounded } from '../support/deadlines.ts';
import { networkFixture } from '../fixtures/network/build.ts';
import { NativeApp } from '../../src/app.ts';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { CPU_ARGS } from '../../src/runtime.ts';
import { encodeFrame, FrameDecoder } from '../../src/protocol/framing.ts';
import { resources, cleanupPriority } from '../support/resources.ts';
import { run } from '../../scripts/lib/toolchain.ts';

const executable = projectPath('build/network-worker');

test('native network decoder agrees with every Node golden command vector', () => {
  assert.equal(run(networkFixture('vectors'), CPU_ARGS), 'True');
});

test('tcp send is observed by an independent peer and recv reads fragmented bytes', async t => {
  const port = await availablePort();
  const received: Buffer[] = [];
  const connected = Promise.withResolvers<Socket>();
  const sent = Promise.withResolvers<void>();
  const server = createServer({ allowHalfOpen: true }, socket => {
    socket.on('data', chunk => received.push(chunk));
    socket.on('data', () => { if (Buffer.concat(received).length === 4) sent.resolve(); });
    connected.resolve(socket);
  });
  await listen(t, server, port);
  const session = await app(t, networkCodec, 'network', { callMs: 4000 });
  const opened = await session.command({ kind: 'connect', host: '127.0.0.1', port });
  assert.equal(opened.kind, 'opened');
  if (opened.kind !== 'opened') throw new Error('expected opened');
  const peer = await bounded(connected.promise);
  peer.write(Buffer.from([1]));
  assert.deepEqual(await session.command({ kind: 'send', id: opened.id, bytes: Buffer.from('ping') }), { kind: 'ok' });
  const first = await session.command({ kind: 'recv', id: opened.id, max: 2 });
  assert.equal(first.kind, 'bytes');
  if (first.kind !== 'bytes') throw new Error('expected bytes');
  assert.deepEqual(first.bytes, Buffer.from([1]));
  peer.write(Buffer.from([2, 3]));
  const rest = await session.command({ kind: 'recv', id: opened.id, max: 8 });
  assert.equal(rest.kind, 'bytes');
  if (rest.kind !== 'bytes') throw new Error('expected bytes');
  assert.deepEqual([...first.bytes, ...rest.bytes], [1, 2, 3]);
  peer.end();
  const eof = await session.command({ kind: 'recv', id: opened.id, max: 8 });
  assert.equal(eof.kind, 'eof');
  await session.command({ kind: 'close', id: opened.id });
  await bounded(sent.promise);
  assert.equal(Buffer.concat(received).toString('utf8'), 'ping');
});

test('udp datagram payload is observed by a separate peer', async t => {
  const port = await availablePort();
  const peer = createUdp({ type: 'udp4' });
  const got = Promise.withResolvers<{ msg: Buffer; port: number }>();
  peer.on('message', (msg, rinfo) => got.resolve({ msg, port: rinfo.port }));
  await bindUdp(t, peer, port);
  const session = await app(t, networkCodec, 'network', { callMs: 4000 });
  const opened = await session.command({ kind: 'bind', host: '127.0.0.1', port: 0 });
  assert.equal(opened.kind, 'opened');
  if (opened.kind !== 'opened') throw new Error('expected opened');
  assert.deepEqual(await session.command({
    kind: 'sendTo', id: opened.id, host: '127.0.0.1', port, bytes: Buffer.from('hi'),
  }), { kind: 'ok' });
  const message = await bounded(got.promise);
  assert.equal(message.msg.toString('utf8'), 'hi');
  peer.send(Buffer.from('pong'), message.port, '127.0.0.1');
  const reply = await session.command({ kind: 'recvFrom', id: opened.id, max: 16, ms: 1000 });
  assert.equal(reply.kind, 'dgram');
  if (reply.kind !== 'dgram') throw new Error('expected dgram');
  assert.equal(Buffer.from(reply.bytes).toString('utf8'), 'pong');
  assert.equal(reply.host, '127.0.0.1');
  assert.equal(reply.port, port);
});

function openedId(reply: Awaited<ReturnType<typeof networkCodec.decode>>): number {
  assert.equal(reply.kind, 'opened');
  if (reply.kind !== 'opened') throw new Error('Expected opened resource');
  return reply.id;
}

test('persistent listeners accept repeatedly, poll and time out without losing ownership', async t => {
  const session = await app(t, networkCodec, 'network');
  const port = await availablePort();
  const id = openedId(await session.command({ kind: 'listen', host: '127.0.0.1', port }));
  assert.deepEqual(await session.command({ kind: 'tryAccept', id, ms: 0 }), { kind: 'timeout' });
  assert.deepEqual(await session.command({ kind: 'tryAccept', id, ms: 20 }), { kind: 'timeout' });
  assert.deepEqual(await session.command({ kind: 'recv', id, max: 1 }), { kind: 'wrongResource' });
  for (const kind of ['accept', 'tryAccept'] as const) {
    const peer = createConnection({ host: '127.0.0.1', port });
    t.after(() => peer.destroy());
    await bounded(new Promise<void>((resolve, reject) => { peer.once('connect', resolve); peer.once('error', reject); }));
    const socketId = openedId(await session.command(kind === 'accept' ? { kind, id } : { kind, id, ms: 1000 }));
    assert.notEqual(socketId, id);
    assert.deepEqual(await session.command({ kind: 'tryRecv', id: socketId, max: 1, ms: 0 }), { kind: 'timeout' });
    peer.write(Buffer.from([255]));
    assert.deepEqual(await session.command({ kind: 'tryRecv', id: socketId, max: 1, ms: 1000 }), { kind: 'bytes', bytes: Buffer.from([255]) });
    await session.command({ kind: 'close', id: socketId });
    assert.deepEqual(await session.command({ kind: 'close', id: socketId }), { kind: 'missing' });
  }
  await session.command({ kind: 'close', id });
  assert.deepEqual(await session.command({ kind: 'tryAccept', id, ms: 0 }), { kind: 'missing' });
  await listen(t, createServer(), port);
});

test('TCP refused connection, half-close, reset, send failure and recovery preserve resource ownership', async t => {
  const session = await app(t, networkCodec, 'network', { callMs: 4000 });
  assert.equal((await session.command({ kind: 'connect', host: '127.0.0.1', port: await availablePort() })).kind, 'fail');
  const peerReady = Promise.withResolvers<Socket>();
  const observed = Promise.withResolvers<Buffer>();
  const server = createServer({ allowHalfOpen: true }, socket => {
    socket.once('data', chunk => observed.resolve(chunk));
    peerReady.resolve(socket);
  });
  const port = await listen(t, server);
  const id = openedId(await session.command({ kind: 'connect', host: '127.0.0.1', port }));
  const peer = await bounded(peerReady.promise);
  peer.end();
  assert.deepEqual(await session.command({ kind: 'tryRecv', id, max: 1, ms: 1000 }), { kind: 'eof' });
  assert.deepEqual(await session.command({ kind: 'trySend', id, bytes: Buffer.from('after-fin'), ms: 1000 }), { kind: 'ok' });
  assert.equal((await bounded(observed.promise)).toString(), 'after-fin');
  await session.command({ kind: 'close', id });
  peer.destroy();
  const resetPeer = Promise.withResolvers<Socket>();
  server.once('connection', socket => resetPeer.resolve(socket));
  const resetId = openedId(await session.command({ kind: 'connect', host: '127.0.0.1', port }));
  (await bounded(resetPeer.promise)).resetAndDestroy();
  const reset = await session.command({ kind: 'tryRecv', id: resetId, max: 1, ms: 1000 });
  assert.equal(reset.kind, 'fail');
  const bytes = Buffer.from([0, 255, 7]);
  const failed = await session.command({ kind: 'trySend', id: resetId, bytes, ms: 1000 });
  assert.equal(failed.kind, 'sendFailure');
  if (failed.kind !== 'sendFailure') throw new Error('Expected send failure');
  assert.deepEqual(failed.unsent, bytes);
  assert.deepEqual(await session.command({ kind: 'close', id: resetId }), { kind: 'ok' });
  const recovered = openedId(await session.command({ kind: 'bind', host: '127.0.0.1', port: 0 }));
  assert.deepEqual(await session.command({ kind: 'recvFrom', id: recovered, max: 1, ms: 0 }), { kind: 'timeout' });
});

test('UDP zero and maximum datagrams retain sender metadata and recover after timeout and malformed raw input', async t => {
  const peer = createUdp('udp4');
  await bindUdp(t, peer);
  const session = await app(t, networkCodec, 'network');
  const port = await availablePort();
  const id = openedId(await session.command({ kind: 'bind', host: '127.0.0.1', port }));
  assert.deepEqual(await session.command({ kind: 'recvFrom', id, max: 192, ms: 10 }), { kind: 'timeout' });
  for (const bytes of [Buffer.alloc(0), Buffer.from(Array.from({ length: 192 }, (_, i) => i))]) {
    await new Promise<void>((resolve, reject) => peer.send(bytes, port, '127.0.0.1', error => error ? reject(error) : resolve()));
    assert.deepEqual(await session.command({ kind: 'recvFrom', id, max: 192, ms: 1000 }), {
      kind: 'dgram', host: '127.0.0.1', port: peer.address().port, bytes,
    });
  }
  const messages: Buffer[] = [];
  peer.on('message', bytes => messages.push(bytes));
  const raw = networkCodec.encode({ kind: 'sendTo', id, host: '127.0.0.1', port: peer.address().port, bytes: Buffer.from('bad') });
  raw[5 + 1] = 120;
  assert.deepEqual(await session.raw(raw), Buffer.from([255]));
  for (const kind of ['sendTo', 'trySendTo'] as const) {
    const bytes = Buffer.alloc(96, 255);
    const got = Promise.withResolvers<Buffer>();
    peer.once('message', bytes => got.resolve(bytes));
    assert.deepEqual(await session.command(kind === 'sendTo'
      ? { kind, id, host: '127.0.0.1', port: peer.address().port, bytes }
      : { kind, id, host: '127.0.0.1', port: peer.address().port, bytes, ms: 1000 }), { kind: 'ok' });
    assert.deepEqual(await bounded(got.promise), bytes);
  }
  assert.equal(messages.length, 2);
  await session.command({ kind: 'close', id });
  assert.deepEqual(await session.command({ kind: 'recvFrom', id, max: 1, ms: 0 }), { kind: 'missing' });
  const replacement = createUdp('udp4');
  await bindUdp(t, replacement, port);
});

test('delayed-read TCP backpressure returns exact unsent bytes and resumes without duplication', { timeout: 120000 }, async t => {
  const ready = Promise.withResolvers<Socket>();
  const chunks: Buffer[] = [];
  const ended = Promise.withResolvers<void>();
  const port = await listen(t, createServer(socket => {
    socket.pause();
    socket.on('data', bytes => chunks.push(bytes));
    socket.on('end', () => ended.resolve());
    ready.resolve(socket);
  }));
  const session = await app(t, networkCodec, 'network', { callMs: 4000 });
  const id = openedId(await session.command({ kind: 'connect', host: '127.0.0.1', port }));
  const peer = await bounded(ready.promise);
  const block = Buffer.from(Array.from({ length: 192 }, (_, i) => i));
  let accepted = 0;
  let unsent: Uint8Array | undefined;
  for (let i = 0; i < 40000; i++) {
    const reply = await session.command({ kind: 'trySend', id, bytes: block, ms: 0 });
    if (reply.kind === 'ok') { accepted += block.length; continue; }
    assert.equal(reply.kind, 'sendTimeout');
    if (reply.kind !== 'sendTimeout') throw new Error('Expected backpressure timeout');
    unsent = reply.unsent;
    assert.ok(unsent.length > 0 && unsent.length <= block.length);
    assert.deepEqual(unsent, block.subarray(block.length - unsent.length));
    accepted += block.length - unsent.length;
    break;
  }
  assert.ok(unsent, 'The peer must create real backpressure, not just delay the test');
  peer.resume();
  assert.deepEqual(await session.command({ kind: 'trySend', id, bytes: unsent, ms: 1000 }), { kind: 'ok' });
  accepted += unsent.length;
  await session.command({ kind: 'close', id });
  await bounded(ended.promise, 10000);
  const observed = Buffer.concat(chunks);
  assert.equal(observed.length, accepted);
  for (let offset = 0; offset < observed.length; offset += block.length) assert.deepEqual(observed.subarray(offset, offset + block.length), block);
});

test('native shutdown acknowledges resource cleanup and closes a retained TCP socket', async t => {
  const peerClosed = Promise.withResolvers<void>();
  const server = createServer(socket => {
    socket.on('end', () => { peerClosed.resolve(); socket.end(); });
  });
  await listen(t, server);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected IPv4 peer');
  const worker = ownNative(t, await BendWorker.start({ executable, contract: NETWORK_CONTRACT }));
  const opened = networkCodec.decode(await worker.call(1, networkCodec.encode({ kind: 'connect', host: '127.0.0.1', port: address.port })));
  assert.equal(opened.kind, 'opened');
  assert.deepEqual(await worker.call(3, Buffer.alloc(0)), Buffer.from([0]));
  await bounded(peerClosed.promise);
});

test('resource ID exhaustion performs no new open and cannot replace the final live ID', async t => {
  const session = ownNative(t, await NativeApp.start(networkCodec, { executable: networkFixture('exhaustion') }));
  const port = await availablePort();
  const id = openedId(await session.command({ kind: 'listen', host: '127.0.0.1', port }));
  assert.equal(id, 0xffffffff);
  const untouchedPort = await availablePort();
  for (const kind of ['listen', 'bind', 'connect'] as const) assert.deepEqual(await session.command({ kind, host: '127.0.0.1', port: untouchedPort }), { kind: 'exhausted' });
  assert.deepEqual(await session.command({ kind: 'tryAccept', id, ms: 0 }), { kind: 'exhausted' });
  await listen(t, createServer(), untouchedPort);
  assert.deepEqual(await session.command({ kind: 'close', id }), { kind: 'ok' });
  await listen(t, createServer(), port);
});

test('raw native network rejects malformed bounds before effects and retains unrelated resources', async t => {
  const session = await app(t, networkCodec, 'network');
  const port = await availablePort();
  const valid = networkCodec.encode({ kind: 'listen', host: '127.0.0.1', port });
  for (let size = 0; size < valid.length; size++) assert.deepEqual(await session.raw(valid.subarray(0, size)), Buffer.from([255]));
  const badPort = Buffer.from(valid);
  badPort.writeUInt32BE(65536, badPort.length - 4);
  const badHost = Buffer.from(valid);
  badHost[2] = 120;
  for (const raw of [Buffer.concat([valid, Buffer.from([0])]), badPort, badHost, Buffer.from([13]), Buffer.from([7, 2, 0xc0, 0xaf, 0, 0, 0, 1])]) {
    assert.deepEqual(await session.raw(raw), Buffer.from([255]));
  }
  const id = openedId(await session.command({ kind: 'listen', host: '127.0.0.1', port }));
  assert.equal(id, 1);
  for (const command of [
    { kind: 'send', id, bytes: Buffer.from([1]) }, { kind: 'recv', id, max: 1 },
    { kind: 'close', id }, { kind: 'accept', id },
    { kind: 'tryAccept', id, ms: 0 }, { kind: 'tryRecv', id, max: 1, ms: 0 },
    { kind: 'recvFrom', id, max: 1, ms: 0 }, { kind: 'trySend', id, bytes: Buffer.from([1]), ms: 0 },
    { kind: 'sendTo', id, host: '127.0.0.1', port: 1, bytes: Buffer.from([1]) },
    { kind: 'trySendTo', id, host: '127.0.0.1', port: 1, bytes: Buffer.from([1]), ms: 0 },
  ] satisfies import('../../contracts/network.ts').NetworkCommand[]) {
    const raw = networkCodec.encode(command);
    for (let size = 0; size < raw.length; size++) assert.deepEqual(await session.raw(raw.subarray(0, size)), Buffer.from([255]));
  }
  const excessiveTime = networkCodec.encode({ kind: 'tryAccept', id, ms: 0 });
  excessiveTime.writeUInt32BE(10001, excessiveTime.length - 4);
  assert.deepEqual(await session.raw(excessiveTime), Buffer.from([255]));
  for (const kind of ['recv', 'tryRecv', 'recvFrom'] as const) for (const max of [0, 193]) {
    const raw = networkCodec.encode(kind === 'recv' ? { kind, id, max: 1 } : { kind, id, max: 1, ms: 0 });
    raw.writeUInt32BE(max, 5);
    assert.deepEqual(await session.raw(raw), Buffer.from([255]));
  }
  const tooManyBytes = Buffer.concat([Buffer.from([1]), Buffer.from([0, 0, 0, id, 193]), Buffer.alloc(193)]);
  assert.deepEqual(await session.raw(tooManyBytes), Buffer.from([255]));
  assert.deepEqual(await session.command({ kind: 'tryAccept', id, ms: 0 }), { kind: 'timeout' });
});

test('graceful network close releases listener and UDP ports and signals TCP EOF', async t => {
  const session = await app(t, networkCodec, 'network');
  const listenerPort = await availablePort();
  const udpPort = await availablePort();
  const listenerId = openedId(await session.command({ kind: 'listen', host: '127.0.0.1', port: listenerPort }));
  await session.command({ kind: 'bind', host: '127.0.0.1', port: udpPort });
  const peer = createConnection({ host: '127.0.0.1', port: listenerPort });
  t.after(() => peer.destroy());
  const eof = Promise.withResolvers<void>();
  peer.on('end', () => eof.resolve());
  await bounded(new Promise<void>((resolve, reject) => { peer.once('connect', resolve); peer.once('error', reject); }));
  await session.command({ kind: 'accept', id: listenerId });
  await session.close();
  await bounded(eof.promise);
  await listen(t, createServer(), listenerPort);
  await bindUdp(t, createUdp('udp4'), udpPort);
});

test('transport disconnect runs native network cleanup callback and releases retained ports', async t => {
  const executable = networkFixture('cleanup');
  const port = await availablePort();
  const child = spawn(executable, [...CPU_ARGS, String(port)], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  child.stdout.on('data', bytes => { stdout += bytes.toString(); });
  const exited = new Promise<void>((resolve, reject) => { child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Native exit ${code}`))); child.once('error', reject); });
  resources(t).add(cleanupPriority.native, async () => { if (child.exitCode === null) child.kill('SIGKILL'); await bounded(exited); });
  let transport: Socket | undefined;
  for (let attempt = 0; attempt < 100 && !transport; attempt++) {
    const socket = createConnection({ host: '127.0.0.1', port });
    const connected = await new Promise<boolean>(resolve => { socket.once('connect', () => resolve(true)); socket.once('error', () => resolve(false)); });
    if (connected) transport = socket;
    else { socket.destroy(); await delay(10); }
  }
  assert.ok(transport);
  t.after(() => transport?.destroy());
  const decoder = new FrameDecoder();
  const replies: Buffer[] = [];
  let waiter = Promise.withResolvers<void>();
  transport.on('data', bytes => { decoder.push(bytes, frame => replies.push(frame.payload)); waiter.resolve(); });
  const exchange = async (kind: 1 | 3, requestId: number, operationId: number, payload: Buffer) => {
    transport.write(encodeFrame({ kind, requestId, operationId, payload }));
    while (!replies.length) { await bounded(waiter.promise); waiter = Promise.withResolvers<void>(); }
    const reply = replies.shift();
    if (!reply) throw new Error('Missing frame');
    return reply;
  };
  assert.deepEqual(await exchange(1, 0, 0, Buffer.from(NETWORK_CONTRACT)), Buffer.from(NETWORK_CONTRACT));
  const listenerPort = await availablePort();
  const udpPort = await availablePort();
  const listenerId = openedId(networkCodec.decode(await exchange(3, 1, 1, networkCodec.encode({ kind: 'listen', host: '127.0.0.1', port: listenerPort }))));
  openedId(networkCodec.decode(await exchange(3, 2, 1, networkCodec.encode({ kind: 'bind', host: '127.0.0.1', port: udpPort }))));
  const peer = createConnection({ host: '127.0.0.1', port: listenerPort });
  t.after(() => peer.destroy());
  const eof = Promise.withResolvers<void>();
  peer.on('end', () => eof.resolve());
  await bounded(new Promise<void>((resolve, reject) => { peer.once('connect', resolve); peer.once('error', reject); }));
  openedId(networkCodec.decode(await exchange(3, 3, 1, networkCodec.encode({ kind: 'accept', id: listenerId }))));
  transport.end();
  await bounded(exited);
  await bounded(eof.promise);
  assert.match(stdout, /network-cleanup-complete/);
  await listen(t, createServer(), listenerPort);
  await bindUdp(t, createUdp('udp4'), udpPort);
});
