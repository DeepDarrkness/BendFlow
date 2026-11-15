import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { CONTRACT, encodeFrame, type Frame } from '../src/protocol/framing.ts';
import { bounded, nativePeer } from './helpers.ts';

const request: Frame = { kind: 3, requestId: 0x01020304, operationId: 65535, payload: Buffer.from([0, 128, 255]) };
const golden = Buffer.from('0000000b010301020304ffff0080ff', 'hex');

test('native Bend accepts handshake golden bytes and echoes every split on one connection', async t => {
  const peer = await nativePeer(t);
  peer.socket.write(Buffer.from('00000018010100000000000042656e64466c6f772f6563686f2f7631', 'hex'));
  assert.deepEqual(await peer.receive(), { kind: 2, requestId: 0, operationId: 0, payload: CONTRACT });
  for (let split = 0; split <= golden.length; split++) {
    peer.socket.write(golden.subarray(0, split));
    await delay(5);
    peer.socket.write(golden.subarray(split));
    assert.deepEqual(await peer.receive(), { ...request, kind: 4 });
  }
  for (const byte of golden) {
    peer.socket.write(Buffer.from([byte]));
    await delay(2);
  }
  assert.deepEqual(await peer.receive(), { ...request, kind: 4 });
});

test('native Bend handles empty, all byte values, maximum, coalesced and repeated frames', async t => {
  const peer = await nativePeer(t);
  await peer.handshake();
  const requests = [Buffer.alloc(0), Buffer.from([0, 128, 255]), Buffer.from(Array.from({ length: 248 }, (_, i) => i)), Buffer.alloc(248, 255)]
    .map((payload, i): Frame => ({ ...request, requestId: i + 1, payload }));
  peer.socket.write(Buffer.concat(requests.map(encodeFrame)));
  for (const f of requests) assert.deepEqual(await peer.receive(), { ...f, kind: 4 });
  for (let i = 0; i < 100; i++) {
    const f = { ...request, requestId: i + 5, payload: Buffer.from([i, 255 - i]) };
    peer.socket.write(encodeFrame(f));
    assert.deepEqual(await peer.receive(), { ...f, kind: 4 });
  }
});

for (const length of [0, 7, 257, 0xffffffff]) {
  test(`native rejects invalid body length ${length} without waiting for a body`, async t => {
    const peer = await nativePeer(t);
    const bytes = Buffer.alloc(4);
    bytes.writeUInt32BE(length);
    peer.socket.write(bytes);
    await bounded(peer.closed.promise);
  });
}

for (const length of [1, 2, 3, 4, 5, 11, 14]) {
  test(`native closes on EOF at frame byte ${length}`, async t => {
    const peer = await nativePeer(t);
    await peer.handshake();
    peer.socket.end(golden.subarray(0, length));
    await bounded(peer.closed.promise);
  });
}

for (const [name, offset, value] of [
  ['version', 4, 2], ['kind zero', 5, 0], ['kind unknown', 5, 255], ['response as request', 5, 4],
  ['zero request ID', 9, 0], ['operation', 11, 1],
] satisfies [string, number, number][]) {
  test(`native rejects invalid ${name}`, async t => {
    const peer = await nativePeer(t);
    await peer.handshake();
    const bytes = Buffer.from(golden);
    if (name === 'zero request ID') bytes.fill(0, 6, 10);
    else bytes[offset] = value;
    peer.socket.write(bytes);
    await bounded(peer.closed.promise);
  });
}

for (const field of ['identifier', 'request ID', 'operation', 'kind', 'missing handshake']) {
  test(`native rejects invalid handshake ${field}`, async t => {
    const peer = await nativePeer(t);
    const hello = encodeFrame({ kind: 1, requestId: 0, operationId: 0, payload: CONTRACT });
    if (field === 'identifier') hello[12] = 0;
    if (field === 'request ID') hello[9] = 1;
    if (field === 'operation') hello[11] = 1;
    if (field === 'kind') hello[5] = 2;
    peer.socket.write(field === 'missing handshake' ? golden : hello);
    await bounded(peer.closed.promise);
  });
}
