import type { FileCommand, FileReply } from '../../../../contracts/file.ts';
import type { NativeCommand, NativeReply } from '../probe.ts';

type CommandVector = NativeCommand & { command: FileCommand };
type ReplyVector = NativeReply & { expected: FileReply };
const path = 'a'.repeat(96), pathHex = '61'.repeat(96);
const bytes = Buffer.alloc(192, 255), bytesHex = 'ff'.repeat(192);
const list = `[${Array.from({ length: 192 }, () => 255).join(', ')}]`;

export const fileCommands = [
  { command: { kind: 'open', path: 'λ😀', mode: 'r' }, hex: '0006cebbf09f98800172', pattern: 'App.Open{"λ😀", "r"}' },
  { command: { kind: 'open', path: '雪', mode: 'r' }, hex: '0003e99baa0172', pattern: 'App.Open{"雪", "r"}' },
  { command: { kind: 'open', path: 'p', mode: 'r+' }, hex: '00017002722b', pattern: 'App.Open{"p", "r+"}' },
  { command: { kind: 'open', path: 'p', mode: 'w' }, hex: '0001700177', pattern: 'App.Open{"p", "w"}' },
  { command: { kind: 'open', path: 'p', mode: 'a' }, hex: '0001700161', pattern: 'App.Open{"p", "a"}' },
  { command: { kind: 'open', path: 'p', mode: 'x' }, hex: '0001700178', pattern: 'App.Open{"p", "x"}' },
  { command: { kind: 'write', id: 1, bytes: Buffer.from([0, 255, 128]) }, hex: '01000000010300ff80', pattern: 'App.Write{1, [0, 255, 128]}' },
  { command: { kind: 'read', id: 1, max: 192 }, hex: '0200000001000000c0', pattern: 'App.Read{1, 192}' },
  { command: { kind: 'size', id: 0xffffffff }, hex: '03ffffffff', pattern: 'App.Size{4294967295}' },
  { command: { kind: 'readAt', id: 1, offset: 0xffffffff, max: 192 }, hex: '0400000001ffffffff000000c0', pattern: 'App.ReadAt{1, 4294967295, 192}' },
  { command: { kind: 'writeAt', id: 1, offset: 0xffffffff, bytes: Buffer.from([128]) }, hex: '0500000001ffffffff0180', pattern: 'App.WriteAt{1, 4294967295, [128]}' },
  { command: { kind: 'close', id: 0xffffffff }, hex: '06ffffffff', pattern: 'App.Drop{4294967295}' },
  { command: { kind: 'capture', id: 0xffffffff }, hex: '07ffffffff', pattern: 'App.Capture{4294967295}' },
  { command: { kind: 'page', snapshot: 0xffffffff, offset: 0xffffffff, max: 192 }, hex: '08ffffffffffffffff000000c0', pattern: 'App.Paging{Pages.Page{4294967295, 4294967295, 192}}' },
  { command: { kind: 'release', snapshot: 0xffffffff }, hex: '09ffffffff', pattern: 'App.Paging{Pages.Release{4294967295}}' },
  { command: { kind: 'open', path, mode: 'r+' }, hex: '0060' + pathHex + '02722b', pattern: `App.Open{"${path}", "r+"}` },
  { command: { kind: 'write', id: 0xffffffff, bytes }, hex: '01ffffffffc0' + bytesHex, pattern: `App.Write{4294967295, ${list}}` },
  { command: { kind: 'writeAt', id: 0xffffffff, offset: 0xffffffff, bytes }, hex: '05ffffffffffffffffc0' + bytesHex, pattern: `App.WriteAt{4294967295, 4294967295, ${list}}` },
  { command: { kind: 'write', id: 1, bytes: Buffer.alloc(0) }, hex: '010000000100', pattern: 'App.Write{1, []}' },
  { command: { kind: 'writeAt', id: 1, offset: 0, bytes: Buffer.alloc(0) }, hex: '05000000010000000000', pattern: 'App.WriteAt{1, 0, []}' },
  { command: { kind: 'read', id: 0xffffffff, max: 0 }, hex: '02ffffffff00000000', pattern: 'App.Read{4294967295, 0}' },
  { command: { kind: 'readAt', id: 0xffffffff, offset: 0, max: 0 }, hex: '04ffffffff0000000000000000', pattern: 'App.ReadAt{4294967295, 0, 0}' },
  { command: { kind: 'page', snapshot: 1, offset: 0, max: 1 }, hex: '08000000010000000000000001', pattern: 'App.Paging{Pages.Page{1, 0, 1}}' },
] satisfies CommandVector[];

export const fileReplies = [
  { kind: 'ok', hex: '00', expression: 'Loop.ok()', expected: { kind: 'ok' } },
  { kind: 'opened', hex: '00ffffffff', expression: 'App.encode_id(4294967295)', expected: { kind: 'opened', id: 0xffffffff } },
  { kind: 'bytes', hex: '010300ff80', expression: 'App.encode_bytes([0, 255, 128])', expected: { kind: 'bytes', bytes: Buffer.from([0, 255, 128]) } },
  { kind: 'fail', hex: '02ffffffff06cebbf09f9880', expression: 'App.encode_fail((4294967295, "λ😀"))', expected: { kind: 'fail', code: 0xffffffff, message: 'λ😀' } },
  { kind: 'missing', hex: '03', expression: 'App.missing()', expected: { kind: 'missing' } },
  { kind: 'size', hex: '04ffffffff', expression: 'App.encode_size(4294967295)', expected: { kind: 'size', value: 0xffffffff } },
  { kind: 'invalidCommand', hex: 'ff', expression: 'Loop.invalid()', expected: { kind: 'invalidCommand' } },
  { kind: 'snapshot', hex: '06ffffffff00000003', expression: 'Pages.descriptor(4294967295, [0, 255, 128])', expected: { kind: 'snapshot', snapshot: 0xffffffff, total: 3 } },
  { kind: 'snapshot', hex: '06ffffffff00010000', expression: 'Pages.descriptor(4294967295, Driver.repeat(65536n, 255))', expected: { kind: 'snapshot', snapshot: 0xffffffff, total: 65536 } },
  { kind: 'page', hex: '0700000001000000000000000300000002000200ff', expression: 'reply(~Pages.Snapshot, Pages.page(~(xs => Bytes.encode_len_bytes(xs)), Pages.Snapshot{2, 1, [0, 255, 128]}, 1, 0, 2))', expected: { kind: 'page', snapshot: 1, offset: 0, total: 3, count: 2, done: false, data: Buffer.from([0, 255]) } },
  { kind: 'page', hex: '0700000001000000020000000300000001010180', expression: 'reply(~Pages.Snapshot, Pages.page(~(xs => Bytes.encode_len_bytes(xs)), Pages.Snapshot{2, 1, [0, 255, 128]}, 1, 2, 192))', expected: { kind: 'page', snapshot: 1, offset: 2, total: 3, count: 1, done: true, data: Buffer.from([128]) } },
  { kind: 'page', hex: '07000000010000000000000000000000000100', expression: 'reply(~Pages.Snapshot, Pages.page(~(xs => Bytes.encode_len_bytes(xs)), Pages.Snapshot{2, 1, []}, 1, 0, 192))', expected: { kind: 'page', snapshot: 1, offset: 0, total: 0, count: 0, done: true, data: Buffer.alloc(0) } },
  { kind: 'stale', hex: '08', expression: 'reply(~Pages.Snapshot, Pages.page(~(xs => Bytes.encode_len_bytes(xs)), Pages.initial(), 1, 0, 192))', expected: { kind: 'stale' } },
  { kind: 'invalidOffset', hex: '09', expression: 'reply(~Pages.Snapshot, Pages.page(~(xs => Bytes.encode_len_bytes(xs)), Pages.Snapshot{2, 1, []}, 1, 1, 192))', expected: { kind: 'invalidOffset' } },
  { kind: 'limit', hex: '0a', expression: 'reply(~App.State, App.capture_bounded(False{}, App.initial(), Pages.initial(), []))', expected: { kind: 'limit' } },
  { kind: 'exhausted', hex: '0b', expression: 'reply(~Pages.Snapshot, Pages.capture(Pages.Snapshot{0, 1, []}, []))', expected: { kind: 'exhausted' } },
  { kind: 'bytes', hex: '0100', expression: 'App.encode_bytes([])', expected: { kind: 'bytes', bytes: Buffer.alloc(0) } },
  { kind: 'bytes', hex: '01c0' + bytesHex, expression: `App.encode_bytes(${list})`, expected: { kind: 'bytes', bytes } },
  { kind: 'fail', hex: '02ffffffff60' + pathHex, expression: `App.encode_fail((4294967295, "${path}"))`, expected: { kind: 'fail', code: 0xffffffff, message: path } },
  { kind: 'fail', hex: '0200000001226e6174697665206572726f72206d657373616765206578636565647320626f756e64', expression: `App.encode_fail((1, "${path}a"))`, expected: { kind: 'fail', code: 1, message: 'native error message exceeds bound' } },
  { kind: 'page', hex: '070000000100000000000000c0000000c001c0' + bytesHex, expression: `reply(~Pages.Snapshot, Pages.page(~(xs => Bytes.encode_len_bytes(xs)), Pages.Snapshot{2, 1, ${list}}, 1, 0, 192))`, expected: { kind: 'page', snapshot: 1, offset: 0, total: 192, count: 192, done: true, data: bytes } },
] satisfies ReplyVector[];

export const fileMalformed = [
  '0a', 'fe', 'ff',
  '00000172', '0001000172', '00037000700172',
  '00017000', '000170017a', '000170027762', '00017002782b',
  '00017008' + '61'.repeat(8),
  '0061' + '61'.repeat(97) + '0172', '00017009' + '61'.repeat(9),
  '010000000000', '020000000000000000', '0300000000',
  '04000000000000000000000000', '05000000000000000000', '0600000000', '0700000000',
  '0100000001c1' + 'ff'.repeat(193), '050000000100000000c1' + 'ff'.repeat(193),
  '0200000001000000c1', '0200000001ffffffff',
  '040000000100000000000000c1', '040000000100000000ffffffff',
  '08000000000000000000000001', '08000000010000000000000000',
  '080000000100000000000000c1', '080000000100000000ffffffff', '0900000000',
];
