import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { taskCodec } from '../../src/protocol/codecs/task.ts';
import { processCodec } from '../../src/protocol/codecs/process.ts';
import { networkCodec } from '../../src/protocol/codecs/network.ts';
import { projectPath } from '../../src/paths.ts';
import { CPU_ARGS } from '../../src/runtime.ts';
import { bun, run, source } from '../../scripts/lib/toolchain.ts';
import { nativeProbe, prefixes, type NativeCommand, type NativeReply } from '../fixtures/codecs/probe.ts';
import type { TaskCommand, TaskReply } from '../../contracts/task.ts';
import type { ProcessCommand, ProcessReply } from '../../contracts/process.ts';
import type { NetworkCommand, NetworkReply } from '../../contracts/network.ts';

type CommandVector<C> = NativeCommand & { command: C };
type ReplyVector<R> = NativeReply & { reply: R };

const taskCommands = [
  { command: { kind: 'nap', ms: 10000 }, hex: '0000002710', pattern: 'App.Nap{10000}' },
  { command: { kind: 'start', ms: 0, text: '😀' }, hex: '010000000004f09f9880', pattern: 'App.Start{0, "😀"}' },
  { command: { kind: 'join', id: 0xffffffff }, hex: '02ffffffff', pattern: 'App.Join{4294967295}' },
  { command: { kind: 'timeout', limit: 1, ms: 2, text: 'x' }, hex: '0300000001000000020178', pattern: 'App.Timeout{1, 2, "x"}' },
  { command: { kind: 'channels', text: '' }, hex: '0400', pattern: 'App.Resource{Resources.Channels{""}}' },
  { command: { kind: 'openFile', path: '/x' }, hex: '05022f78', pattern: 'App.Resource{Resources.OpenFile{"/x"}}' },
  { command: { kind: 'writeFile', text: 'a' }, hex: '060161', pattern: 'App.Resource{Resources.WriteFile{"a"}}' },
  { command: { kind: 'transfer', text: 'b' }, hex: '070162', pattern: 'App.Resource{Resources.Transfer{"b"}}' },
  { command: { kind: 'release' }, hex: '08', pattern: 'App.Resource{Resources.Release{}}' },
  { command: { kind: 'collect' }, hex: '09', pattern: 'App.Resource{Resources.Collect{}}' },
  { command: { kind: 'closeFile' }, hex: '0a', pattern: 'App.Resource{Resources.CloseFile{}}' },
] satisfies CommandVector<TaskCommand>[];

const processCommands = [
  { command: { kind: 'env', name: 'X' }, hex: '000158', pattern: 'App.Env{"X"}' },
  { command: { kind: 'args' }, hex: '01', pattern: 'App.Args{}' },
  { command: { kind: 'run', program: '/x', arg: ';', input: '😀' }, hex: '02022f78013b04f09f9880', pattern: 'App.Run{"/x", ";", "😀"}' },
  { command: { kind: 'random' }, hex: '03', pattern: 'App.Random{}' },
  { command: { kind: 'fixture', behavior: 'report', arg: 'a', input: 'b' }, hex: '040001610162', pattern: 'App.Fixture{0, "a", "b"}' },
  { command: { kind: 'fixture', behavior: 'success', arg: '', input: '' }, hex: '04010000', pattern: 'App.Fixture{1, "", ""}' },
  { command: { kind: 'fixture', behavior: 'timeout', arg: '', input: '' }, hex: '04020000', pattern: 'App.Fixture{2, "", ""}' },
  { command: { kind: 'fixture', behavior: 'overflow', arg: '', input: '' }, hex: '04030000', pattern: 'App.Fixture{3, "", ""}' },
] satisfies CommandVector<ProcessCommand>[];

const networkCommands = [
  { command: { kind: 'connect', host: '1.2.3.4', port: 65535 }, hex: '0007312e322e332e340000ffff', pattern: 'App.Connect{"1.2.3.4", 65535}' },
  { command: { kind: 'send', id: 1, bytes: Buffer.from([0, 255]) }, hex: '01000000010200ff', pattern: 'App.Send{1, [0, 255]}' },
  { command: { kind: 'recv', id: 1, max: 192 }, hex: '0200000001000000c0', pattern: 'App.Recv{1, 192}' },
  { command: { kind: 'close', id: 1 }, hex: '0300000001', pattern: 'App.Drop{1}' },
  { command: { kind: 'bind', host: '1.2.3.4', port: 0 }, hex: '0407312e322e332e3400000000', pattern: 'App.Bind{"1.2.3.4", 0}' },
  { command: { kind: 'sendTo', id: 1, host: '1.2.3.4', port: 1, bytes: Buffer.alloc(0) }, hex: '050000000107312e322e332e340000000100', pattern: 'App.SendTo{1, "1.2.3.4", 1, []}' },
  { command: { kind: 'recvFrom', id: 1, max: 192, ms: 10000 }, hex: '0600000001000000c000002710', pattern: 'App.RecvFrom{1, 192, 10000}' },
  { command: { kind: 'listen', host: '1.2.3.4', port: 0 }, hex: '0707312e322e332e3400000000', pattern: 'App.Listen{"1.2.3.4", 0}' },
  { command: { kind: 'accept', id: 1 }, hex: '0800000001', pattern: 'App.Accept{1}' },
  { command: { kind: 'tryAccept', id: 1, ms: 0 }, hex: '090000000100000000', pattern: 'App.TryAccept{1, 0}' },
  { command: { kind: 'tryRecv', id: 1, max: 1, ms: 10000 }, hex: '0a000000010000000100002710', pattern: 'App.TryRecv{1, 1, 10000}' },
  { command: { kind: 'trySend', id: 1, bytes: Buffer.from([255]), ms: 1 }, hex: '0b0000000101ff00000001', pattern: 'App.TrySend{1, [255], 1}' },
  { command: { kind: 'trySendTo', id: 1, host: '1.2.3.4', port: 1, bytes: Buffer.from([255]), ms: 1 }, hex: '0c0000000107312e322e332e340000000101ff00000001', pattern: 'App.TrySendTo{1, "1.2.3.4", 1, [255], 1}' },
] satisfies CommandVector<NetworkCommand>[];

const taskReplies = [
  { kind: 'ok', hex: '00', expression: 'Resources.write_reply(Done{Unit{}})', reply: { kind: 'ok' } },
  { kind: 'started', hex: '00ffffffff', expression: 'App.encode_id(4294967295)', reply: { kind: 'started', id: 0xffffffff } },
  { kind: 'text', hex: '0104f09f9880', expression: 'App.encode_text(1, "😀")', reply: { kind: 'text', text: '😀' } },
  { kind: 'fail', hex: '020000004b03626164', expression: 'App.encode_fail((75, "bad"))', reply: { kind: 'fail', code: 75, message: 'bad' } },
  { kind: 'missing', hex: '03', expression: 'App.missing()', reply: { kind: 'missing' } },
  { kind: 'invalidCommand', hex: 'ff', expression: 'Loop.invalid()', reply: { kind: 'invalidCommand' } },
] satisfies ReplyVector<TaskReply>[];

const processReplies = [
  { kind: 'text', hex: '0104f09f9880', expression: 'App.env_reply(Done{"😀"})', reply: { kind: 'text', text: '😀' } },
  { kind: 'fail', hex: '020000000203626164', expression: 'App.env_reply(Fail{(2, "bad")})', reply: { kind: 'fail', code: 2, message: 'bad' } },
  { kind: 'run', hex: '0300000007016f0165', expression: 'App.run_reply(Done{(7, ("o", "e"))})', reply: { kind: 'run', code: 7, stdout: 'o', stderr: 'e' } },
  { kind: 'random', hex: '04ffffffff', expression: 'App.random_reply(Done{4294967295})', reply: { kind: 'random', value: 0xffffffff } },
  { kind: 'invalidCommand', hex: 'ff', expression: 'Loop.invalid()', reply: { kind: 'invalidCommand' } },
  { kind: 'run failure', hex: '020000000203626164', expression: 'App.run_reply(Fail{(2, "bad")})', reply: { kind: 'fail', code: 2, message: 'bad' } },
  { kind: 'random failure', hex: '020000000203626164', expression: 'App.random_reply(Fail{(2, "bad")})', reply: { kind: 'fail', code: 2, message: 'bad' } },
  { kind: 'run output boundary', hex: '030000000060' + '6f'.repeat(96) + '60' + '65'.repeat(96),
    expression: `App.run_reply(Done{(0, ("${'o'.repeat(96)}", "${'e'.repeat(96)}"))})`,
    reply: { kind: 'run', code: 0, stdout: 'o'.repeat(96), stderr: 'e'.repeat(96) } },
  ...['stdout', 'stderr'].map(stream => ({ kind: `run ${stream} overflow`,
    hex: '020000004b187265706c792065786365656473207465787420626f756e64',
    expression: `App.run_reply(Done{(0, ("${stream === 'stdout' ? 'x'.repeat(97) : ''}", "${stream === 'stderr' ? 'x'.repeat(97) : ''}"))})`,
    reply: { kind: 'fail', code: 75, message: 'reply exceeds text bound' } satisfies ProcessReply })),
] satisfies ReplyVector<ProcessReply>[];

const networkReplies = [
  { kind: 'ok', hex: '00', expression: 'App.send_reply(Done{Unit{}})', reply: { kind: 'ok' } },
  { kind: 'bytes', hex: '010200ff', expression: 'App.recv_reply(Done{Some{[0, 255]}})', reply: { kind: 'bytes', bytes: Buffer.from([0, 255]) } },
  { kind: 'fail', hex: '020000000503e29883', expression: 'App.recv_reply(Fail{(5, "☃")})', reply: { kind: 'fail', code: 5, message: '☃' } },
  { kind: 'eof', hex: '05', expression: 'App.recv_reply(Done{None{}})', reply: { kind: 'eof' } },
  { kind: 'dgram', hex: '0607312e322e332e340000ffff0200ff', expression: 'App.dgram_poll(Ready{Done{("1.2.3.4", 65535, [0, 255])}})', reply: { kind: 'dgram', host: '1.2.3.4', port: 65535, bytes: Buffer.from([0, 255]) } },
  { kind: 'timeout', hex: '07', expression: 'App.recv_poll(Wait{Unit{}})', reply: { kind: 'timeout' } },
  { kind: 'sendFailure', hex: '08000000200200ff', expression: 'App.send_reply(Fail{((32, "ignored"), [0, 255])})', reply: { kind: 'sendFailure', code: 32, unsent: Buffer.from([0, 255]) } },
  { kind: 'sendTimeout', hex: '090200ff', expression: 'App.send_poll(Wait{[0, 255]})', reply: { kind: 'sendTimeout', unsent: Buffer.from([0, 255]) } },
  { kind: 'invalidCommand', hex: 'ff', expression: 'Loop.invalid()', reply: { kind: 'invalidCommand' } },
] satisfies ReplyVector<NetworkReply>[];

function nativeBytes(line: string | undefined): Buffer {
  assert.ok(line, 'missing native output');
  const value: unknown = JSON.parse(line);
  assert.ok(Array.isArray(value));
  const bytes: number[] = [];
  for (const byte of value) {
    assert.ok(typeof byte === 'number' && Number.isInteger(byte) && byte >= 0 && byte <= 255);
    bytes.push(byte);
  }
  return Buffer.from(bytes);
}

function checkReplies<R>(lines: readonly string[], vectors: readonly { hex: string; reply: R }[], decode: (bytes: Buffer) => R): void {
  assert.equal(lines.length, vectors.length);
  for (const [i, vector] of vectors.entries()) {
    const bytes = nativeBytes(lines[i]);
    assert.equal(bytes.toString('hex'), vector.hex, `production native reply ${vector.reply && JSON.stringify(vector.reply)}`);
    assert.deepEqual(decode(bytes), vector.reply);
    assert.deepEqual(decode(Buffer.from(vector.hex, 'hex')), vector.reply);
    for (const suffix of ['00', 'ff']) assert.throws(() => decode(Buffer.from(vector.hex + suffix, 'hex')), `reply trailing ${vector.hex}/${suffix}`);
    for (const prefix of prefixes(vector.hex)) {
      // Tag zero alone is a complete ok reply, not a truncated started/opened reply.
      if (prefix === '00') { assert.deepEqual(decode(Buffer.from(prefix, 'hex')), { kind: 'ok' }); continue; }
      assert.throws(() => decode(Buffer.from(prefix, 'hex')), `reply prefix ${vector.hex}/${prefix}`);
    }
  }
}

function checkProbe<C, R>(options: {
  name: string; module: string; imports?: string; commands: readonly CommandVector<C>[];
  replies: readonly ReplyVector<R>[]; malformed: readonly string[];
}, encode: (command: C) => Buffer, decode: (bytes: Buffer) => R): void {
  const lines = nativeProbe(options);
  assert.equal(lines.length, options.commands.length * 2 + 1 + options.replies.length);
  for (const [i, vector] of options.commands.entries()) {
    assert.equal(encode(vector.command).toString('hex'), vector.hex);
    assert.equal(lines[i * 2], 'True', `native constructor ${vector.pattern}`);
    assert.equal(lines[i * 2 + 1], 'True', `all native prefixes and trailing 00/ff: ${vector.command && JSON.stringify(vector.command)}`);
  }
  assert.equal(lines[options.commands.length * 2], 'True', 'native invalid tags, semantic bounds and UTF-8');
  checkReplies(lines.slice(options.commands.length * 2 + 1), options.replies, decode);
}

function checkBoundaries<C>(name: string, module: string, commands: readonly CommandVector<C>[], encode: (command: C) => Buffer, imports?: string): void {
  const helpers = `
def boundary_result(ok: Bool) -> List<&2, U32>:
  match ok:
    case True{}:
      [1]
    case False{}:
      [0]
` + commands.map(({ pattern }, i) => {
    const fields: string[] = [];
    const constructor = pattern.replace(/"(?:\\.|[^"\\])*"/g, literal => {
      const field = `text_${fields.length}`;
      fields.push(`String.eq(${field}, ${literal})`);
      return field;
    });
    const equality = fields.reduce((rest, field) => `Bool.and(${field}, ${rest})`, 'True{}');
    return `
def boundary_${i}(got: Maybe<&2, App.Command>) -> List<&2, U32>:
  match got:
    case Some{${constructor}}:
      boundary_result(${equality})
    case other:
      [0]
`;
  }).join('');
  const replies = commands.map(({ hex }, i) => ({ kind: 'boundary', hex: '01',
    expression: `boundary_${i}(App.take_command([${[...Buffer.from(hex, 'hex')].join(', ')}]))` }));
  const lines = nativeProbe({ name, module, imports, helpers, commands: [], replies, malformed: [] });
  assert.equal(lines.length, commands.length + 1);
  assert.equal(lines[0], 'True');
  for (const [i, vector] of commands.entries()) {
    assert.equal(encode(vector.command).toString('hex'), vector.hex);
    assert.equal(lines[i + 1], '[1]', `native exact boundary ${vector.pattern}`);
  }
}

test('portable task native goldens cover all commands and production replies with exhaustive prefix/trailing rejection', () => {
  checkProbe({ name: 'portable-effect-task', module: 'task-app', imports: 'import ../../bend/task-resources.bend as Resources',
    commands: taskCommands, replies: taskReplies, malformed: taskMalformed() }, taskCodec.encode, taskCodec.decode);
});

test('portable process native goldens cover all commands, fixture behaviors and production replies with exhaustive prefix/trailing rejection', () => {
  checkProbe({ name: 'portable-effect-process', module: 'process-app', commands: processCommands,
    replies: processReplies, malformed: processMalformed() }, processCodec.encode, processCodec.decode);
});

test('portable network native goldens cover all commands and production reply encoders with exhaustive prefix/trailing rejection', () => {
  checkProbe({ name: 'portable-effect-network', module: 'network-app', commands: networkCommands,
    replies: networkReplies, malformed: networkMalformed() }, networkCodec.encode, networkCodec.decode);
});

test('portable native affine result branches complete task timeout and network opened/wrongResource/missing/exhausted reply goldens', () => {
  const directory = projectPath('build/codecs');
  mkdirSync(directory, { recursive: true });
  const output = resolve(directory, 'portable-effect-branches');
  run(bun, [resolve(source, 'bend2/main.ts'), projectPath('tests/fixtures/codecs/effects/portable-effect-branches.bend'), '-o', output]);
  const lines = run(output, CPU_ARGS).split('\n');
  assert.equal(lines.length, 5);
  checkReplies(lines.slice(0, 1), [{ hex: '05', reply: { kind: 'timeout' } }], taskCodec.decode);
  checkReplies(lines.slice(1), [
    { hex: '00ffffffff', reply: { kind: 'opened', id: 0xffffffff } },
    { hex: '0a', reply: { kind: 'wrongResource' } },
    { hex: '03', reply: { kind: 'missing' } },
    { hex: '0b', reply: { kind: 'exhausted' } },
  ], networkCodec.decode);
});

test('portable native command parsers accept exact task and process byte/domain boundaries', () => {
  const taskBoundary = [
    ...['start', 'channels', 'writeFile', 'transfer'].map(kind => {
      const text = '😀'.repeat(16);
      switch (kind) {
        case 'start': return { command: { kind, ms: 10000, text }, hex: '010000271040' + 'f09f9880'.repeat(16), pattern: `App.Start{10000, "${text}"}` } satisfies CommandVector<TaskCommand>;
        case 'channels': return { command: { kind, text }, hex: '0440' + 'f09f9880'.repeat(16), pattern: `App.Resource{Resources.Channels{"${text}"}}` } satisfies CommandVector<TaskCommand>;
        case 'writeFile': return { command: { kind, text }, hex: '0640' + 'f09f9880'.repeat(16), pattern: `App.Resource{Resources.WriteFile{"${text}"}}` } satisfies CommandVector<TaskCommand>;
        case 'transfer': return { command: { kind, text }, hex: '0740' + 'f09f9880'.repeat(16), pattern: `App.Resource{Resources.Transfer{"${text}"}}` } satisfies CommandVector<TaskCommand>;
        default: throw new Error(`Unexpected boundary command ${kind}`);
      }
    }),
    { command: { kind: 'nap', ms: 0 }, hex: '0000000000', pattern: 'App.Nap{0}' },
    { command: { kind: 'join', id: 1 }, hex: '0200000001', pattern: 'App.Join{1}' },
    { command: { kind: 'timeout', limit: 10000, ms: 10000, text: 'x'.repeat(32) }, hex: '03000027100000271020' + '78'.repeat(32), pattern: `App.Timeout{10000, 10000, "${'x'.repeat(32)}"}` },
    { command: { kind: 'timeout', limit: 0, ms: 0, text: '' }, hex: '03000000000000000000', pattern: 'App.Timeout{0, 0, ""}' },
    { command: { kind: 'openFile', path: 'p'.repeat(96) }, hex: '0560' + '70'.repeat(96), pattern: `App.Resource{Resources.OpenFile{"${'p'.repeat(96)}"}}` },
  ] satisfies CommandVector<TaskCommand>[];
  const processBoundary = [
    { command: { kind: 'env', name: 'n'.repeat(96) }, hex: '0060' + '6e'.repeat(96), pattern: `App.Env{"${'n'.repeat(96)}"}` },
    { command: { kind: 'run', program: 'p'.repeat(96), arg: 'a'.repeat(64), input: 'i'.repeat(64) },
      hex: '0260' + '70'.repeat(96) + '40' + '61'.repeat(64) + '40' + '69'.repeat(64),
      pattern: `App.Run{"${'p'.repeat(96)}", "${'a'.repeat(64)}", "${'i'.repeat(64)}"}` },
    { command: { kind: 'fixture', behavior: 'report', arg: 'a'.repeat(32), input: 'i'.repeat(32) },
      hex: '040020' + '61'.repeat(32) + '20' + '69'.repeat(32), pattern: `App.Fixture{0, "${'a'.repeat(32)}", "${'i'.repeat(32)}"}` },
    { command: { kind: 'run', program: 'p', arg: '', input: '\0' }, hex: '020170000100', pattern: 'App.Run{"p", "", "\\0"}' },
  ] satisfies CommandVector<ProcessCommand>[];
  checkBoundaries('portable-effect-task-boundaries', 'task-app', taskBoundary, taskCodec.encode, 'import ../../bend/task-resources.bend as Resources');
  checkBoundaries('portable-effect-process-boundaries', 'process-app', processBoundary, processCodec.encode);
});

const invalidUtf8 = ['c0af', 'eda080', 'f4908080', 'ff', '80', 'e282', 'f09f98'];
function textHex(hex: string): string { return (hex.length / 2).toString(16).padStart(2, '0') + hex; }
function asciiHex(text: string): string { return textHex(Buffer.from(text).toString('hex')); }

function taskMalformed(): string[] {
  return ['0b', 'fe', 'ff', '0000002711', '010000271100', '0200000000',
    '03000027110000000000', '03000000000000271100', '0500', '050100',
    ...[1, 4, 6, 7].map(tag => tag.toString(16).padStart(2, '0') + (tag === 1 ? '00000000' : '') + asciiHex('x'.repeat(65))),
    '030000000000000000' + asciiHex('x'.repeat(33)), '05' + asciiHex('x'.repeat(97)),
    ...invalidUtf8.flatMap(hex => [
      '0100000000' + textHex(hex), '030000000000000000' + textHex(hex),
      ...['04', '05', '06', '07'].map(tag => tag + textHex(hex)),
    ])];
}

function processMalformed(): string[] {
  return ['05', 'fe', 'ff', '0000', '00013d', '000100', '02000000', '0201000000', '020170010000', '04040000', '0400010000',
    '00' + asciiHex('x'.repeat(97)), '02' + asciiHex('p'.repeat(97)) + '0000',
    '020170' + asciiHex('a'.repeat(65)) + '00', '02017000' + asciiHex('i'.repeat(65)),
    '0400' + asciiHex('a'.repeat(33)) + '00', '040000' + asciiHex('i'.repeat(33)),
    ...invalidUtf8.flatMap(hex => [
      '00' + textHex(hex), '02' + textHex(hex) + '0000', '020170' + textHex(hex) + '00',
      '02017000' + textHex(hex), '0400' + textHex(hex) + '00', '040000' + textHex(hex),
    ])];
}

function networkMalformed(): string[] {
  return ['0d', 'fe', 'ff',
    ...networkCommands.filter(vector => 'id' in vector.command).map(vector => vector.hex.slice(0, 2) + '00000000' + vector.hex.slice(10)),
    ...['00', '04', '07'].flatMap(tag => [tag + '07312e322e332e3400010000',
      ...['', 'localhost', '256.0.0.1', '01.2.3.4', '1.2.3', '1.2.3.4\0'].map(host => tag + asciiHex(host) + '00000001'),
      ...invalidUtf8.map(hex => tag + textHex(hex) + '00000001')]),
    '0007312e322e332e3400000000',
    ...['02', '06', '0a'].flatMap(tag => ['00000000', '000000c1'].map(max => tag + '00000001' + max + (tag === '02' ? '' : '00000000'))),
    ...networkCommands.filter(vector => 'ms' in vector.command).map(vector => vector.hex.slice(0, -8) + '00002711'),
    '0100000001' + textHex('00'.repeat(193)), '0b00000001' + textHex('00'.repeat(193)) + '00000000',
    ...['05', '0c'].flatMap(tag => [tag + '0000000107312e322e332e3400000001' + textHex('00'.repeat(97)) + (tag === '0c' ? '00000000' : ''),
      tag + '0000000107312e322e332e340001000000' + (tag === '0c' ? '00000000' : ''),
      ...invalidUtf8.map(hex => tag + '00000001' + textHex(hex) + '0000000100' + (tag === '0c' ? '00000000' : ''))]),
  ];
}

// Runtime no-effect/recovery evidence complements these pure parser probes:
// tasks-process-http.test.ts: HTTP malformed task and process commands fail before effects and preserve recovery.
// network-http.test.ts and network.test.ts: malformed HTTP/raw native commands retain resources and do not send/bind.
test('portable reply decoders reject invalid tags, semantic domains and malformed UTF-8 independently', () => {
  for (const codec of [taskCodec, processCodec, networkCodec]) {
    for (const hex of ['', 'fe', ...invalidUtf8.map(hex => '0200000001' + textHex(hex))]) {
      assert.throws(() => codec.decode(Buffer.from(hex, 'hex')), hex);
    }
  }
  for (const hex of ['04', '0000000000', '01' + asciiHex('x'.repeat(65))]) assert.throws(() => taskCodec.decode(Buffer.from(hex, 'hex')));
  for (const hex of ['00', '05', '01' + asciiHex('x'.repeat(97)), '0300000000' + asciiHex('x'.repeat(97)) + '00']) assert.throws(() => processCodec.decode(Buffer.from(hex, 'hex')));
  for (const hex of invalidUtf8) {
    assert.throws(() => taskCodec.decode(Buffer.from('01' + textHex(hex), 'hex')));
    for (const payload of ['01' + textHex(hex), '0300000000' + textHex(hex) + '00', '030000000000' + textHex(hex)]) {
      assert.throws(() => processCodec.decode(Buffer.from(payload, 'hex')));
    }
    assert.throws(() => networkCodec.decode(Buffer.from('06' + textHex(hex) + '0000000100', 'hex')));
  }
  for (const hex of ['04', '0c', '0000000000', '0601780000000100', '0607312e322e332e340001000000',
    ...[1, 9].map(tag => tag.toString(16).padStart(2, '0') + textHex('00'.repeat(193))),
    '0800000020' + textHex('00'.repeat(193)), '0607312e322e332e3400000001' + textHex('00'.repeat(193))]) {
    assert.throws(() => networkCodec.decode(Buffer.from(hex, 'hex')), hex);
  }
});
