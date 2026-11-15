import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { createSocket as createUdp } from 'node:dgram';
import { resolve } from 'node:path';
import test, { type TestContext } from 'node:test';
import { NativeApp } from '../../src/app.ts';
import { networkCodec } from '../../src/protocol/apps.ts';
import { availablePort } from '../../src/worker.ts';
import { assertGone, bounded } from '../helpers.ts';

const executable = resolve('build/network-worker');

async function app(t: TestContext) {
  const session = await NativeApp.start(networkCodec, { executable, callMs: 4000 });
  t.after(async () => { await bounded(session.close()); assertGone(session.pid); });
  return session;
}

test('tcp send is observed by an independent peer and recv reads fragmented bytes', async t => {
  const port = await availablePort();
  const received: Buffer[] = [];
  const server = createServer(socket => {
    socket.on('data', chunk => received.push(chunk));
    socket.write(Buffer.from([1, 2, 3]));
    socket.end();
  });
  await new Promise<void>(resolve => server.listen(port, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const session = await app(t);
  const opened = await session.command({ kind: 'connect', host: '127.0.0.1', port });
  assert.equal(opened.kind, 'opened');
  if (opened.kind !== 'opened') throw new Error('expected opened');
  assert.deepEqual(await session.command({ kind: 'send', id: opened.id, bytes: Buffer.from('ping') }), { kind: 'ok' });
  const first = await session.command({ kind: 'recv', id: opened.id, max: 2 });
  assert.equal(first.kind, 'bytes');
  if (first.kind !== 'bytes') throw new Error('expected bytes');
  const rest = await session.command({ kind: 'recv', id: opened.id, max: 8 });
  assert.equal(rest.kind, 'bytes');
  if (rest.kind !== 'bytes') throw new Error('expected bytes');
  assert.deepEqual([...first.bytes, ...rest.bytes], [1, 2, 3]);
  const eof = await session.command({ kind: 'recv', id: opened.id, max: 8 });
  assert.equal(eof.kind, 'eof');
  await session.command({ kind: 'close', id: opened.id });
  assert.equal(Buffer.concat(received).toString('utf8'), 'ping');
});

test('udp datagram payload is observed by a separate peer', async t => {
  const port = await availablePort();
  const peer = createUdp({ type: 'udp4' });
  const got = Promise.withResolvers<{ msg: Buffer; port: number }>();
  peer.on('message', (msg, rinfo) => got.resolve({ msg, port: rinfo.port }));
  await new Promise<void>(resolve => peer.bind(port, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => peer.close(() => resolve())));
  const session = await app(t);
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
});
