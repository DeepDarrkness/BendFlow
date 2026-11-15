import assert from 'node:assert/strict';
import test from 'node:test';
import { taskCodec } from '../../src/protocol/codecs/task.ts';
import { processCodec } from '../../src/protocol/codecs/process.ts';
import type { TaskCommand, TaskReply } from '../../contracts/task.ts';
import type { ProcessCommand, ProcessReply } from '../../contracts/process.ts';

const taskCommands: [TaskCommand, string][] = [
  [{ kind: 'nap', ms: 10000 }, '0000002710'],
  [{ kind: 'start', ms: 0, text: '😀' }, '010000000004f09f9880'],
  [{ kind: 'join', id: 0xffffffff }, '02ffffffff'],
  [{ kind: 'timeout', limit: 1, ms: 2, text: 'x' }, '0300000001000000020178'],
  [{ kind: 'channels', text: '' }, '0400'],
  [{ kind: 'openFile', path: '/x' }, '05022f78'],
  [{ kind: 'writeFile', text: 'a' }, '060161'],
  [{ kind: 'transfer', text: 'b' }, '070162'],
  [{ kind: 'release' }, '08'], [{ kind: 'collect' }, '09'], [{ kind: 'closeFile' }, '0a'],
];
const processCommands: [ProcessCommand, string][] = [
  [{ kind: 'env', name: 'X' }, '000158'], [{ kind: 'args' }, '01'],
  [{ kind: 'run', program: '/x', arg: ';', input: '😀' }, '02022f78013b04f09f9880'],
  [{ kind: 'random' }, '03'],
  [{ kind: 'fixture', behavior: 'report', arg: 'a', input: 'b' }, '040001610162'],
  [{ kind: 'fixture', behavior: 'success', arg: '', input: '' }, '04010000'],
  [{ kind: 'fixture', behavior: 'timeout', arg: '', input: '' }, '04020000'],
  [{ kind: 'fixture', behavior: 'overflow', arg: '', input: '' }, '04030000'],
];
const taskReplies: [TaskReply, string][] = [
  [{ kind: 'ok' }, '00'], [{ kind: 'started', id: 0xffffffff }, '00ffffffff'],
  [{ kind: 'text', text: '😀' }, '0104f09f9880'],
  [{ kind: 'fail', code: 75, message: 'bad' }, '020000004b03626164'],
  [{ kind: 'missing' }, '03'], [{ kind: 'timeout' }, '05'], [{ kind: 'invalidCommand' }, 'ff'],
];
const processReplies: [ProcessReply, string][] = [
  [{ kind: 'text', text: '😀' }, '0104f09f9880'],
  [{ kind: 'fail', code: 2, message: 'bad' }, '020000000203626164'],
  [{ kind: 'run', code: 7, stdout: 'o', stderr: 'e' }, '0300000007016f0165'],
  [{ kind: 'random', value: 0xffffffff }, '04ffffffff'], [{ kind: 'invalidCommand' }, 'ff'],
];

test('task and process codecs encode every command and decode every reply golden vector', () => {
  for (const [command, hex] of taskCommands) assert.equal(taskCodec.encode(command).toString('hex'), hex);
  for (const [command, hex] of processCommands) assert.equal(processCodec.encode(command).toString('hex'), hex);
  for (const [reply, hex] of taskReplies) assert.deepEqual(taskCodec.decode(Buffer.from(hex, 'hex')), reply);
  for (const [reply, hex] of processReplies) assert.deepEqual(processCodec.decode(Buffer.from(hex, 'hex')), reply);
});

test('task and process codecs reject unknown tags truncation trailing bytes and malformed UTF-8', () => {
  for (const [codec, vectors] of [[taskCodec, taskReplies], [processCodec, processReplies]] as const) {
    for (const bad of ['','fe','0102c0af','0103eda080','0104f4908080','0101ff']) assert.throws(() => codec.decode(Buffer.from(bad, 'hex')));
    for (const [, hex] of vectors) {
      const payload = Buffer.from(hex, 'hex');
      assert.throws(() => codec.decode(Buffer.concat([payload, Buffer.from([0])])));
      for (let length = 0; length < payload.length; length++) {
        if (codec === taskCodec && hex === '00ffffffff' && length === 1) continue;
        assert.throws(() => codec.decode(payload.subarray(0, length)));
      }
    }
  }
  assert.throws(() => taskCodec.decode(Buffer.from('0000000000', 'hex')));
});

test('task and process codec field semantic and complete payload bounds are exact', () => {
  for (const kind of ['start', 'channels', 'writeFile', 'transfer'] as const) {
    const command = kind === 'start' ? { kind, ms: 10000, text: '😀'.repeat(16) } : { kind, text: '😀'.repeat(16) };
    assert.ok(taskCodec.encode(command).length <= 248);
    assert.throws(() => taskCodec.parse({ ...command, text: '😀'.repeat(16) + 'x' }));
  }
  assert.ok(taskCodec.encode({ kind: 'timeout', limit: 10000, ms: 10000, text: 'x'.repeat(32) }).length <= 248);
  assert.throws(() => taskCodec.parse({ kind: 'timeout', limit: 0, ms: 0, text: 'x'.repeat(33) }));
  for (const ms of [-1, 10001, 0.5, Infinity]) assert.throws(() => taskCodec.parse({ kind: 'nap', ms }));
  for (const id of [0, -1, 0x100000000]) assert.throws(() => taskCodec.parse({ kind: 'join', id }));
  for (const path of ['', '\0', '\ud800', 'x'.repeat(97)]) {
    assert.throws(() => taskCodec.parse({ kind: 'openFile', path }));
    assert.throws(() => processCodec.parse({ kind: 'run', program: path, arg: '', input: '' }));
  }
  for (const name of ['', 'A=B', '\0', '\ud800', 'x'.repeat(97)]) assert.throws(() => processCodec.parse({ kind: 'env', name }));
  const maximum = { kind: 'run', program: 'p'.repeat(96), arg: 'a'.repeat(64), input: 'i'.repeat(64) } satisfies ProcessCommand;
  assert.equal(processCodec.encode(maximum).length, 228);
  for (const key of ['program', 'arg', 'input'] as const) assert.throws(() => processCodec.parse({ ...maximum, [key]: maximum[key] + 'x' }));
  assert.throws(() => processCodec.parse({ ...maximum, arg: '\0' }));
  for (const codec of [taskCodec, processCodec]) assert.throws(() => codec.parse({ kind: 'random', extra: true }));
  assert.equal(processCodec.encode({ kind: 'fixture', behavior: 'report', arg: 'x'.repeat(32), input: 'y'.repeat(32) }).length, 68);
  assert.throws(() => processCodec.parse({ kind: 'fixture', behavior: 'report', arg: 'x'.repeat(33), input: '' }));
  assert.throws(() => processCodec.parse({ kind: 'fixture', behavior: 'unknown', arg: '', input: '' }));
  assert.deepEqual(taskCodec.decode(Buffer.from([1, 64, ...Buffer.alloc(64, 120)])), { kind: 'text', text: 'x'.repeat(64) });
  assert.throws(() => taskCodec.decode(Buffer.from([1, 65, ...Buffer.alloc(65, 120)])));
  assert.deepEqual(processCodec.decode(Buffer.from([1, 96, ...Buffer.alloc(96, 120)])), { kind: 'text', text: 'x'.repeat(96) });
  assert.throws(() => processCodec.decode(Buffer.from([1, 97, ...Buffer.alloc(97, 120)])));
  const reply = Buffer.from([3, 0, 0, 0, 0, 96, ...Buffer.alloc(96, 111), 96, ...Buffer.alloc(96, 101)]);
  assert.equal(reply.length, 199);
  assert.deepEqual(processCodec.decode(reply), { kind: 'run', code: 0, stdout: 'o'.repeat(96), stderr: 'e'.repeat(96) });
});
