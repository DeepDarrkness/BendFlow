import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { projectPath } from '../../src/paths.ts';
import { CPU_ARGS } from '../../src/runtime.ts';
import { bun, run, source } from '../../scripts/lib/toolchain.ts';
import { nativeProbe, prefixes, type NativeCommand, type NativeReply } from '../fixtures/codecs/probe.ts';
import { collectionCommands, collectionReplies, collectionMalformed } from '../fixtures/codecs/collection-file/collection.ts';
import { fileCommands, fileReplies, fileMalformed } from '../fixtures/codecs/collection-file/file.ts';
import { malformedUtf8, collectionTextSlots, fileTextSlots } from '../fixtures/codecs/collection-file/utf8.ts';
import { collectionCodec } from '../../src/protocol/codecs/collection.ts';
import { fileCodec } from '../../src/protocol/codecs/file.ts';
import { COLLECTION_ENCODED_COMMAND_BOUNDS, COLLECTION_ENCODED_REPLY_BOUNDS } from '../../contracts/collection.ts';
import { FILE_ENCODED_COMMAND_BOUNDS, FILE_ENCODED_REPLY_BOUNDS } from '../../contracts/file.ts';
import { collectionMalformedReplies, fileMalformedReplies, collectionReplyTextSlots, fileReplyTextSlots } from '../fixtures/codecs/collection-file/malformed-replies.ts';

const helpers = `
def reply(~S: Type, got: S & List<&2, U32>) -> List<&2, U32>:
  (state, bytes) = got
  bytes
`;

// Large vectors use runtime prefix traversal: a literal list containing every
// prefix of a 202-byte command overflows Bend's checker stack.
function boundaryProbe(options: {
  name: string; module: string; commands: readonly NativeCommand[];
  replies: readonly NativeReply[]; malformed: readonly string[];
}): string[] {
  const bytes = (hex: string) => `[${[...Buffer.from(hex, 'hex')].join(', ')}]`;
  const directory = projectPath('build/codecs');
  mkdirSync(directory, { recursive: true });
  const input = projectPath(`build/codecs/${options.name}-boundaries.bend`);
  const output = projectPath(`build/codecs/${options.name}-boundaries`);
  const statements = [
    ...options.commands.flatMap((v, i) => [
      `    Unit <- IO.print(Bool.show(command_${i}(App.take_command(${bytes(v.hex)}))))`,
      `    Unit <- IO.print(Bool.show(Driver.strict(~reject, ${bytes(v.hex)})))`,
    ]),
    ...options.malformed.map(hex => `    Unit <- IO.print(Bool.show(reject(${bytes(hex)})))`),
    ...options.replies.map(v => `    Unit <- IO.print(Driver.show(${v.expression}))`),
  ];
  const sections = Array.from({ length: Math.ceil(statements.length / 12) }, (_, i) => statements.slice(i * 12, i * 12 + 12));
  writeFileSync(input, `import Base
import ../../bend/${options.module}.bend as App
import ../../bend/bytes.bend as Bytes
import ../../bend/loop.bend as Loop
import ../../bend/pages.bend as Pages
import ../../bend/collection-features.bend as Features
import ../../tests/fixtures/codecs/collection-file/driver.bend as Driver
${helpers}
def rejected(got: Maybe<&2, App.Command>) -> Bool:
  match got:
    case None{}:
      True{}
    case Some{command}:
      False{}

def reject(bytes: List<&2, U32>) -> Bool:
  rejected(App.take_command(bytes))
${options.commands.map((v, i) => {
    const checks: string[] = [];
    const pattern = v.pattern.replace(/"[^"]*"|\[[^\]]*\]/g, literal => {
      const field = `field_${checks.length}`;
      checks.push(`${literal.startsWith('"') ? 'String.eq' : 'Driver.equal'}(${field}, ${literal})`);
      return field;
    });
    return `
def command_${i}(got: Maybe<&2, App.Command>) -> Bool:
  match got:
    case Some{${pattern}}:
      ${checks.reduceRight((rest, check) => `Bool.and(${check}, ${rest})`, 'True{}')}
    case other:
      False{}
`;
  }).join('')}
${sections.map((lines, i) => `def section_${i}() -> IO(Unit):
  do IO<Unit>:
${lines.join('\n')}
    return Unit{}
`).join('\n')}
def main() -> IO(Unit):
  do IO<Unit>:
${sections.map((_, i) => `    Unit <- section_${i}()`).join('\n')}
    return Unit{}
`);
  run(bun, [projectPath(`${source}/bend2/main.ts`), input, '-o', output]);
  return run(output, CPU_ARGS).split('\n');
}

function check<C extends { kind: string }, R extends { kind: string }>(options: {
  name: string; module: string;
  commands: readonly (NativeCommand & { command: C })[];
  replies: readonly (NativeReply & { expected: R })[];
  malformed: readonly string[];
  commandBounds: Record<C['kind'], number>; replyBounds: Record<R['kind'], number>;
  encode: (command: C) => Buffer; decode: (bytes: Buffer) => R;
}): void {
  const { commands, replies, encode, decode, commandBounds, replyBounds } = options;
  assert.deepEqual([...new Set(commands.map(v => v.command.kind))].sort(), Object.keys(commandBounds).sort());
  assert.deepEqual([...new Set(replies.map(v => v.expected.kind))].sort(), Object.keys(replyBounds).sort());
  const small = commands.filter(v => v.hex.length / 2 <= 40);
  const large = commands.filter(v => v.hex.length / 2 > 40);
  const smallOutput: string[] = [];
  for (let start = 0; start < small.length; start += 20) {
    const batch = small.slice(start, start + 20);
    const lines = nativeProbe({ ...options, name: `${options.name}-${start}`, commands: batch, replies: [], malformed: [], helpers });
    assert.equal(lines.length, batch.length * 2 + 1);
    smallOutput.push(...lines.slice(0, -1));
  }
  const largeOutput = boundaryProbe({ ...options, commands: large });
  assert.equal(largeOutput.length, large.length * 2 + options.malformed.length + replies.length);
  for (const [i, hex] of options.malformed.entries()) {
    assert.equal(largeOutput[large.length * 2 + i], 'True', `${options.name} native malformed ${hex}`);
  }
  const output = commands.flatMap(v => {
    const index = small.indexOf(v);
    const lines = index >= 0 ? smallOutput : largeOutput;
    const offset = (index >= 0 ? index : large.indexOf(v)) * 2;
    return lines.slice(offset, offset + 2);
  }).concat(largeOutput.slice(large.length * 2 + options.malformed.length));
  assert.equal(output.length, commands.length * 2 + replies.length);
  for (const [i, vector] of commands.entries()) {
    assert.equal(encode(vector.command).toString('hex'), vector.hex, `${options.name} TS ${vector.command.kind}`);
    assert.equal(output[i * 2], 'True', `${options.name} native constructor ${vector.command.kind}: ${vector.hex}`);
    assert.equal(output[i * 2 + 1], 'True', `${options.name} every raw prefix and trailing 00/ff: ${vector.hex}`);
  }
  for (const [i, vector] of replies.entries()) {
    const value: unknown = JSON.parse(output[commands.length * 2 + i] ?? 'null');
    assert.ok(Array.isArray(value) && value.every(n => Number.isInteger(n) && n >= 0 && n <= 255));
    assert.equal(Buffer.from(value).toString('hex'), vector.hex, `${options.name} native ${vector.kind} golden bytes`);
    assert.deepEqual(decode(Buffer.from(value)), vector.expected, `${options.name} independent ${vector.kind} value`);
    for (const hex of [...prefixes(vector.hex), vector.hex + '00', vector.hex + 'ff']) {
      // File's empty success reply is also a valid strict prefix of opened.
      if (options.name === 'collection-file-file' && vector.kind === 'opened' && hex === '00') continue;
      assert.throws(() => decode(Buffer.from(hex, 'hex')), `${options.name} malformed reply ${vector.kind}: ${hex}`);
    }
  }
  for (const [kind, bound] of Object.entries(commandBounds)) {
    assert.ok(commands.some(v => v.command.kind === kind && v.hex.length / 2 === bound), `${options.name} maximum command ${kind}: ${bound}`);
  }
  for (const [kind, bound] of Object.entries(replyBounds)) {
    assert.ok(replies.some(v => v.expected.kind === kind && v.hex.length / 2 === bound), `${options.name} maximum reply ${kind}: ${bound}`);
  }
}

test('collection portable native golden vectors cover every command, nested branch, reply and exact bound', () => {
  check({ name: 'collection-file-collection', module: 'collection', commands: collectionCommands, replies: collectionReplies,
    malformed: [...collectionMalformed, ...collectionTextSlots.flatMap(([before, after]) => malformedUtf8.map(raw => before + raw + after))],
    commandBounds: COLLECTION_ENCODED_COMMAND_BOUNDS, replyBounds: COLLECTION_ENCODED_REPLY_BOUNDS,
    encode: collectionCodec.encode, decode: collectionCodec.decode });
});

test('file portable native golden vectors cover every command, mode, reply and exact bound', () => {
  check({ name: 'collection-file-file', module: 'file-app', commands: fileCommands, replies: fileReplies,
    malformed: [...fileMalformed, ...fileTextSlots.flatMap(([before, after]) => malformedUtf8.map(raw => before + raw + after))],
    commandBounds: FILE_ENCODED_COMMAND_BOUNDS, replyBounds: FILE_ENCODED_REPLY_BOUNDS,
    encode: fileCodec.encode, decode: fileCodec.decode });
});

test('collection golden reply decoder rejects unknown tags, UTF-8, nested flags, page metadata and one-over bounds', () => {
  for (const hex of [...collectionMalformedReplies,
    ...collectionReplyTextSlots.flatMap(([before, after]) => malformedUtf8.map(raw => before + raw + after))]) {
    assert.throws(() => collectionCodec.decode(Buffer.from(hex, 'hex')), `collection malformed reply ${hex}`);
  }
});

test('file golden reply decoder rejects unknown tags, UTF-8, zero IDs, page metadata and one-over bounds', () => {
  for (const hex of [...fileMalformedReplies,
    ...fileReplyTextSlots.flatMap(([before, after]) => malformedUtf8.map(raw => before + raw + after))]) {
    assert.throws(() => fileCodec.decode(Buffer.from(hex, 'hex')), `file malformed reply ${hex}`);
  }
});
