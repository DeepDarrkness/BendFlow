import type { ComputeCommand, ComputeReply } from '../../../../contracts/compute.ts';

// Fixed network-order words, including high-bit values; these are specification bytes.
export const maxWordsHex =
  '0000000000000001000000020000000300000004000000050000000600000007' +
  '00000008000000090000000a0000000b0000000c0000000d0000000e0000000f' +
  '0000001000000011000000120000001300000014000000150000001600000017' +
  '00000018000000190000001a0000001b0000001c0000001d0000001effffffff';
export const maxWords = [...Array.from({ length: 31 }, (_, i) => i), 0xffffffff];

export const commands = [
  { command: { kind: 'sum', items: [] }, hex: '0000', pattern: 'App.Sum{[]}' },
  { command: { kind: 'sum', items: [0x80000000, 0xffffffff] }, hex: '000280000000ffffffff', pattern: 'App.Sum{[2147483648, 4294967295]}' },
  { command: { kind: 'sum', items: maxWords }, hex: '0020' + maxWordsHex, pattern: `App.Sum{[${maxWords.join(', ')}]}` },
  { command: { kind: 'threads' }, hex: '01', pattern: 'App.Threads{}' },
  { command: { kind: 'frame' }, hex: '02', pattern: 'App.Frame{}' },
  { command: { kind: 'sort', items: [] }, hex: '0300', pattern: 'App.Sort{[]}' },
  { command: { kind: 'sort', items: [0xffffffff, 0, 0x80000000] }, hex: '0303ffffffff0000000080000000', pattern: 'App.Sort{[4294967295, 0, 2147483648]}' },
  { command: { kind: 'sort', items: maxWords }, hex: '0320' + maxWordsHex, pattern: `App.Sort{[${maxWords.join(', ')}]}` },
  { command: { kind: 'advance', steps: 0 }, hex: '0400000000', pattern: 'App.Advance{0}' },
  { command: { kind: 'advance', steps: 1024 }, hex: '0400000400', pattern: 'App.Advance{1024}' },
  { command: { kind: 'inspect' }, hex: '05', pattern: 'App.Inspect{}' },
  { command: { kind: 'reset' }, hex: '06', pattern: 'App.Reset{}' },
  { command: { kind: 'event', event: { kind: 'key', code: 0xffffffff, down: true } }, hex: '0700ffffffff01', pattern: 'App.ApplyEvent{Key{4294967295, True{}}}' },
  { command: { kind: 'event', event: { kind: 'key', code: 0, down: false } }, hex: '07000000000000', pattern: 'App.ApplyEvent{Key{0, False{}}}' },
  { command: { kind: 'event', event: { kind: 'focus', on: true } }, hex: '070101', pattern: 'App.ApplyEvent{Focus{True{}}}' },
  { command: { kind: 'event', event: { kind: 'focus', on: false } }, hex: '070100', pattern: 'App.ApplyEvent{Focus{False{}}}' },
  { command: { kind: 'event', event: { kind: 'close' } }, hex: '0702', pattern: 'App.ApplyEvent{Close{}}' },
  { command: { kind: 'render', depth: 0 }, hex: '0800000000', pattern: 'App.Render{0}' },
  { command: { kind: 'render', depth: 4 }, hex: '0800000004', pattern: 'App.Render{4}' },
  { command: { kind: 'samples', count: 0 }, hex: '0900000000', pattern: 'App.Samples{0}' },
  { command: { kind: 'samples', count: 512 }, hex: '0900000200', pattern: 'App.Samples{512}' },
  { command: { kind: 'page', snapshot: 1, offset: 0, max: 1 }, hex: '0a000000010000000000000001', pattern: 'App.Page{1, 0, 1}' },
  { command: { kind: 'page', snapshot: 0xffffffff, offset: 0xffffffff, max: 32 }, hex: '0affffffffffffffff00000020', pattern: 'App.Page{4294967295, 4294967295, 32}' },
  { command: { kind: 'release', snapshot: 1 }, hex: '0b00000001', pattern: 'App.Release{1}' },
  { command: { kind: 'release', snapshot: 0xffffffff }, hex: '0bffffffff', pattern: 'App.Release{4294967295}' },
] satisfies { command: ComputeCommand; hex: string; pattern: string }[];

export const malformedCommands = [
  '0c', 'fe', 'ff', '0703', '07ff',
  '07000000002002', '070000000020ff', '070102', '0701ff',
  '0400000401', '04ffffffff', '0800000005', '08ffffffff', '0900000201', '09ffffffff',
  '0a000000000000000000000001', '0a000000010000000000000000',
  '0a000000010000000000000021', '0a0000000100000000ffffffff', '0b00000000',
  '0021' + maxWordsHex + '00000000', '0321' + maxWordsHex + '00000000',
  '00ff', '03ff',
];

const execute = (state: string, command: string) => `Fixture.execute(${state}, ${command})`;
export const replies = [
  { kind: 'invalidCommand', hex: 'ff', expression: 'Loop.invalid()', expected: { kind: 'invalidCommand' } },
  { kind: 'sum', hex: '00ffffffff', expression: execute('App.initial()', 'App.Sum{[4294967295]}'), expected: { kind: 'sum', value: 0xffffffff } },
  { kind: 'sum wrapping', hex: '0000000000', expression: execute('App.initial()', 'App.Sum{[4294967295, 1]}'), expected: { kind: 'sum', value: 0 } },
  { kind: 'pixels', hex: '020400000001000000020000000300000004', expression: execute('App.initial()', 'App.Frame{}'), expected: { kind: 'pixels', items: [1, 2, 3, 4] } },
  { kind: 'sorted', hex: '03030000000080000000ffffffff', expression: execute('App.initial()', 'App.Sort{[4294967295, 0, 2147483648]}'), expected: { kind: 'sorted', items: [0, 0x80000000, 0xffffffff] } },
  { kind: 'sorted empty', hex: '0300', expression: execute('App.initial()', 'App.Sort{[]}'), expected: { kind: 'sorted', items: [] } },
  { kind: 'simulation seeded', hex: '040000000700000013000000020001', expression: execute('Fixture.seeded()', 'App.Inspect{}'), expected: { kind: 'simulation', tick: 7, position: 19, velocity: 2, running: false, closed: true } },
  { kind: 'simulation reset', hex: '040000000000000000000000010100', expression: execute('Fixture.seeded()', 'App.Reset{}'), expected: { kind: 'simulation', tick: 0, position: 0, velocity: 1, running: true, closed: false } },
  { kind: 'snapshot render', hex: '060000000100000001', expression: execute('App.initial()', 'App.Render{0}'), expected: { kind: 'snapshot', snapshot: 1, total: 1 } },
  { kind: 'snapshot empty', hex: '060000000100000000', expression: execute('App.initial()', 'App.Samples{0}'), expected: { kind: 'snapshot', snapshot: 1, total: 0 } },
  { kind: 'snapshot max', hex: '060000000100000200', expression: execute('App.initial()', 'App.Samples{512}'), expected: { kind: 'snapshot', snapshot: 1, total: 512 } },
  { kind: 'page partial', hex: '070000002a00000000000000030000000200020000000080000000', expression: execute('Fixture.seeded()', 'App.Page{42, 0, 2}'), expected: { kind: 'page', snapshot: 42, offset: 0, total: 3, count: 2, done: false, data: [0, 0x80000000] } },
  { kind: 'page final', hex: '070000002a0000000200000003000000010101ffffffff', expression: execute('Fixture.seeded()', 'App.Page{42, 2, 32}'), expected: { kind: 'page', snapshot: 42, offset: 2, total: 3, count: 1, done: true, data: [0xffffffff] } },
  { kind: 'page terminal', hex: '070000002a0000000300000003000000000100', expression: execute('Fixture.seeded()', 'App.Page{42, 3, 1}'), expected: { kind: 'page', snapshot: 42, offset: 3, total: 3, count: 0, done: true, data: [] } },
  { kind: 'page max', hex: '070000002a0000000000000020000000200120' + maxWordsHex, expression: execute('Fixture.full()', 'App.Page{42, 0, 32}'), expected: { kind: 'page', snapshot: 42, offset: 0, total: 32, count: 32, done: true, data: maxWords } },
  { kind: 'ok', hex: '05', expression: execute('Fixture.seeded()', 'App.Release{42}'), expected: { kind: 'ok' } },
  { kind: 'busy render', hex: '0800', expression: execute('Fixture.seeded()', 'App.Render{0}'), expected: { kind: 'error', reason: 'busy' } },
  { kind: 'busy samples', hex: '0800', expression: execute('Fixture.seeded()', 'App.Samples{0}'), expected: { kind: 'error', reason: 'busy' } },
  { kind: 'stale page', hex: '0801', expression: execute('Fixture.seeded()', 'App.Page{41, 0, 1}'), expected: { kind: 'error', reason: 'stale' } },
  { kind: 'stale release', hex: '0801', expression: execute('Fixture.seeded()', 'App.Release{41}'), expected: { kind: 'error', reason: 'stale' } },
  { kind: 'range', hex: '0802', expression: execute('Fixture.seeded()', 'App.Page{42, 4294967295, 1}'), expected: { kind: 'error', reason: 'range' } },
  { kind: 'exhausted render', hex: '0803', expression: execute('Fixture.exhausted()', 'App.Render{0}'), expected: { kind: 'error', reason: 'exhausted' } },
  { kind: 'exhausted samples', hex: '0803', expression: execute('Fixture.exhausted()', 'App.Samples{0}'), expected: { kind: 'error', reason: 'exhausted' } },
  { kind: 'overflow', hex: '0804', expression: execute('Fixture.overflow()', 'App.Advance{1}'), expected: { kind: 'error', reason: 'overflow' } },
] satisfies { kind: string; hex: string; expression: string; expected: ComputeReply }[];

export const malformedReplies = [
  '09', 'fe', '0805', '08ff', '0100000000', '0221' + maxWordsHex + '00000000', '0321' + maxWordsHex + '00000000',
  '040000271100000000000000010100', // tick 10001
  '040000000000000100000000010100', // position 256
  '040000000000000000000000000100', '040000000000000000000000030100',
  '040000000000000000000000010200', '040000000000000000000000010102',
  '060000000000000000', '060000000100000201',
  '07000000000000000000000000000000000100', // zero ID
  '07000000010000000000000201000000000100', // total 513
  '07000000010000000100000000000000000100', // offset beyond total
  '07000000010000000000000001000000000100', // empty nonterminal / wrong done
  '07000000010000000000000001000000000000', // empty nonterminal
  '07000000010000000000000000000000000000', // terminal must be done
  '07000000010000000000000001000000010100', // count != data length
  '0700000001000000000000000100000000010100000000', // data != count
  '0700000001000000010000000100000001010100000000', // offset + count beyond total
  '0700000001000000000000000100000001000100000000', // final must be done
  '0700000001000000000000000200000001010100000000', // premature done
  '0700000001000000000000000100000001020100000000', // invalid bool
  '07000000010000000000000021000000210121' + maxWordsHex + '00000000', // cap 33
];
