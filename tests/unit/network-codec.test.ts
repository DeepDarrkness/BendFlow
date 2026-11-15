import assert from 'node:assert/strict';
import test from 'node:test';
import { networkCodec } from '../../src/protocol/codecs/network.ts';
import type { NetworkCommand, NetworkReply } from '../../contracts/network.ts';

const commands: { command: NetworkCommand; hex: string }[] = [
  { command: { kind: 'connect', host: '1.2.3.4', port: 65535 }, hex: '0007312e322e332e340000ffff' },
  { command: { kind: 'send', id: 1, bytes: Buffer.from([0, 255]) }, hex: '01000000010200ff' },
  { command: { kind: 'recv', id: 1, max: 192 }, hex: '0200000001000000c0' },
  { command: { kind: 'close', id: 1 }, hex: '0300000001' },
  { command: { kind: 'bind', host: '1.2.3.4', port: 0 }, hex: '0407312e322e332e3400000000' },
  { command: { kind: 'sendTo', id: 1, host: '1.2.3.4', port: 1, bytes: Buffer.alloc(0) }, hex: '050000000107312e322e332e340000000100' },
  { command: { kind: 'recvFrom', id: 1, max: 192, ms: 10000 }, hex: '0600000001000000c000002710' },
  { command: { kind: 'listen', host: '1.2.3.4', port: 0 }, hex: '0707312e322e332e3400000000' },
  { command: { kind: 'accept', id: 1 }, hex: '0800000001' },
  { command: { kind: 'tryAccept', id: 1, ms: 0 }, hex: '090000000100000000' },
  { command: { kind: 'tryRecv', id: 1, max: 1, ms: 10000 }, hex: '0a000000010000000100002710' },
  { command: { kind: 'trySend', id: 1, bytes: Buffer.from([255]), ms: 1 }, hex: '0b0000000101ff00000001' },
  { command: { kind: 'trySendTo', id: 1, host: '1.2.3.4', port: 1, bytes: Buffer.from([255]), ms: 1 }, hex: '0c0000000107312e322e332e340000000101ff00000001' },
];

const replies: { hex: string; reply: NetworkReply }[] = [
  { hex: '00', reply: { kind: 'ok' } },
  { hex: '00ffffffff', reply: { kind: 'opened', id: 0xffffffff } },
  { hex: '010200ff', reply: { kind: 'bytes', bytes: Buffer.from([0, 255]) } },
  { hex: '020000000503e29883', reply: { kind: 'fail', code: 5, message: '☃' } },
  { hex: '03', reply: { kind: 'missing' } },
  { hex: '05', reply: { kind: 'eof' } },
  { hex: '0607312e322e332e340000ffff0200ff', reply: { kind: 'dgram', host: '1.2.3.4', port: 65535, bytes: Buffer.from([0, 255]) } },
  { hex: '07', reply: { kind: 'timeout' } },
  { hex: '08000000200200ff', reply: { kind: 'sendFailure', code: 32, unsent: Buffer.from([0, 255]) } },
  { hex: '090200ff', reply: { kind: 'sendTimeout', unsent: Buffer.from([0, 255]) } },
  { hex: '0a', reply: { kind: 'wrongResource' } },
  { hex: '0b', reply: { kind: 'exhausted' } },
  { hex: 'ff', reply: { kind: 'invalidCommand' } },
];

test('network codec golden vectors cover every command and reply variant', () => {
  for (const { command, hex } of commands) assert.equal(networkCodec.encode(command).toString('hex'), hex, command.kind);
  for (const { reply, hex } of replies) assert.deepEqual(networkCodec.decode(Buffer.from(hex, 'hex')), reply, reply.kind);
});

test('network codec rejects unknown tags, truncation, trailing bytes, invalid UTF-8 and invalid reply domains', () => {
  for (const { hex } of replies) {
    const payload = Buffer.from(hex, 'hex');
    assert.throws(() => networkCodec.decode(Buffer.concat([payload, Buffer.from([42])])));
    for (let size = 0; size < payload.length; size++) {
      if (payload[0] === 0 && size === 1) continue;
      assert.throws(() => networkCodec.decode(payload.subarray(0, size)));
    }
  }
  for (const hex of ['04', '0c', '0000000000', '020000000102c0af', '0601ff0000000100', '0601780000000100', '0607312e322e332e340001000000']) {
    assert.throws(() => networkCodec.decode(Buffer.from(hex, 'hex')), hex);
  }
});

test('network codec enforces exact binary, ID, port, time and address bounds', () => {
  for (const { command } of commands) {
    assert.throws(() => networkCodec.parse({ ...command, extra: true }));
    if ('id' in command) for (const id of [0, -1, 2 ** 32, 1.5]) assert.throws(() => networkCodec.parse({ ...command, id }));
    if ('ms' in command) for (const ms of [-1, 10001, 0.5]) assert.throws(() => networkCodec.parse({ ...command, ms }));
    if ('max' in command) for (const max of [0, 193]) assert.throws(() => networkCodec.parse({ ...command, max }));
    if ('host' in command) {
      for (const host of ['', 'localhost', '256.0.0.1', '01.2.3.4', '1.2.3', '1.2.3.4\0', '☃']) assert.throws(() => networkCodec.parse({ ...command, host }));
      for (const port of [-1, 65536]) assert.throws(() => networkCodec.parse({ ...command, port }));
    }
    if ('bytes' in command) {
      const max = command.kind === 'sendTo' || command.kind === 'trySendTo' ? 96 : 192;
      assert.ok(networkCodec.encode({ ...command, bytes: Buffer.alloc(max) }).length <= 248);
      assert.throws(() => networkCodec.encode({ ...command, bytes: Buffer.alloc(max + 1) }));
    }
  }
  for (const tag of [1, 9]) {
    assert.equal(networkCodec.decode(Buffer.concat([Buffer.from([tag, 192]), Buffer.alloc(192)])).kind, tag === 1 ? 'bytes' : 'sendTimeout');
    assert.throws(() => networkCodec.decode(Buffer.concat([Buffer.from([tag, 193]), Buffer.alloc(193)])));
  }
  for (const size of [0, 192, 193]) {
    const raw = Buffer.concat([Buffer.from('0800000020', 'hex'), Buffer.from([size]), Buffer.alloc(size)]);
    if (size <= 192) assert.equal(networkCodec.decode(raw).kind, 'sendFailure');
    else assert.throws(() => networkCodec.decode(raw));
    const dgram = Buffer.concat([Buffer.from('0607312e322e332e340000ffff', 'hex'), Buffer.from([size]), Buffer.alloc(size)]);
    if (size <= 192) assert.equal(networkCodec.decode(dgram).kind, 'dgram');
    else assert.throws(() => networkCodec.decode(dgram));
  }
  for (const size of [0, 96, 97]) {
    const raw = Buffer.concat([Buffer.from('0200000005', 'hex'), Buffer.from([size]), Buffer.alloc(size, 65)]);
    if (size <= 96) assert.equal(networkCodec.decode(raw).kind, 'fail');
    else assert.throws(() => networkCodec.decode(raw));
  }
});
