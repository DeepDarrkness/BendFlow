import assert from 'node:assert/strict';
import test from 'node:test';
import { nativeProbe, prefixes, type NativeReply } from '../fixtures/codecs/probe.ts';
import { collectionCodec, fileCodec, taskCodec, processCodec, computeCodec, networkCodec, customCodec, numericCodec } from '../../src/protocol/apps.ts';
import { encodeCommand, decodeReply } from '../../src/protocol/session.ts';
import { app, session } from '../support/native.ts';

const unit = 'Loop.ok()';
const invalid = 'Loop.invalid()';
const pair = `
def reply(~S: Type, got: S & List<&2, U32>) -> List<&2, U32>:
  (state, bytes) = got
  bytes
`;
const reply = (kind: string, hex: string, expression: string): NativeReply => ({ kind, hex, expression });

test('session native golden commands, replies and every malformed prefix agree independently', async t => {
  const commands = [
    { command: { kind: 'add', amount: 7 }, hex: '0000000007', pattern: 'Session.Add{7}' },
    { command: { kind: 'read' }, hex: '01', pattern: 'Session.Read{}' },
    { command: { kind: 'reset' }, hex: '02', pattern: 'Session.Reset{}' },
  ] satisfies { command: Parameters<typeof encodeCommand>[0]; hex: string; pattern: string }[];
  const replies = [reply('value', '000000000700000001', 'App.encode_reply(Session.Value{Session.Snapshot{7, 1}})'),
    reply('overflow', '01ffffffff00000002', 'App.encode_reply(Session.Overflow{Session.Snapshot{4294967295, 2}})')];
  const output = nativeProbe({ name: 'session', module: 'session-worker', parser: 'App.decode_command',
    imports: 'import ../../bend/session.bend as Session', commands, replies, malformed: ['ff', '03'] });
  check(output, commands, replies, encodeCommand, decodeReply);
  const native = await session(t);
  assert.deepEqual(await native.raw(Buffer.from([255])), Buffer.from([2]));
});

function check<C, R>(output: string[], commands: readonly { command: C; hex: string }[], replies: readonly NativeReply[],
  encode: (command: C) => Buffer, decode: (bytes: Buffer) => R): void {
  assert.equal(output.length, commands.length * 2 + 1 + replies.length);
  for (const [i, vector] of commands.entries()) {
    assert.equal(encode(vector.command).toString('hex'), vector.hex);
    assert.equal(output[i * 2], 'True', `native constructor ${vector.hex}`);
    assert.equal(output[i * 2 + 1], 'True', `prefix/trailing rejection ${vector.hex}`);
  }
  assert.equal(output[commands.length * 2], 'True', 'semantic and malformed rejection');
  for (const [i, vector] of replies.entries()) {
    const value: unknown = JSON.parse(output[commands.length * 2 + 1 + i] ?? 'null');
    assert.ok(Array.isArray(value) && value.every(n => typeof n === 'number' && n >= 0 && n <= 255));
    const bytes = Buffer.from(value);
    assert.equal(bytes.toString('hex'), vector.hex, `native ${vector.kind}`);
    assert.deepEqual(decode(bytes), decode(Buffer.from(vector.hex, 'hex')));
  }
}
