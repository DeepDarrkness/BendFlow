import assert from 'node:assert/strict';
import test from 'node:test';
import { computeCodec, COMPUTE_CONTRACT } from '../../src/protocol/codecs/compute.ts';
import { MAX_BODY, MAX_PAYLOAD, HEADER_SIZE, encodeFrame, FrameDecoder } from '../../src/protocol/framing.ts';
import { ITEMS_PAGE_CAP } from '../../contracts/pages.ts';
import { COMPUTE_MAX_TOTAL } from '../../contracts/compute.ts';
import { projectPath } from '../../src/paths.ts';
import { bun, run, source } from '../../scripts/lib/toolchain.ts';
import { worker } from '../support/native.ts';
import { nativeProbe, prefixes } from '../fixtures/codecs/probe.ts';
import { commands, replies, malformedCommands, malformedReplies, maxWordsHex } from '../fixtures/codecs/compute/portable-acceptance-vectors.ts';

function printedBytes(line: string | undefined): Buffer {
  const value: unknown = JSON.parse(line ?? 'null');
  assert.ok(Array.isArray(value) && value.every(n => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 255));
  return Buffer.from(value);
}

function rejectReply(hex: string): void {
  assert.throws(() => computeCodec.decode(Buffer.from(hex, 'hex')), `reject reply ${hex}`);
}

test('portable compute native codec acceptance', async t => {
  const output = nativeProbe({
    name: 'compute-portable-acceptance', module: 'compute-app', commands, replies, malformed: malformedCommands,
    imports: 'import ../../tests/fixtures/codecs/compute/portable-acceptance-helpers.bend as Fixture',
  });
  assert.equal(output.length, commands.length * 2 + 1 + replies.length);

  await t.test('every command and nested event has independent native constructor goldens and exhaustive prefix/trailing rejection', () => {
    for (const [i, vector] of commands.entries()) {
      assert.equal(computeCodec.encode(vector.command).toString('hex'), vector.hex, `Node ${vector.command.kind}`);
      assert.equal(output[i * 2], 'True', `native constructor ${vector.hex}`);
      assert.equal(output[i * 2 + 1], 'True', `native rejects every prefix and trailing 00/ff of ${vector.hex}`);
    }
    assert.equal(output[commands.length * 2], 'True', 'native rejects unknown tags, invalid bools, IDs and one-over/max-word bounds');
  });

  await t.test('production native reply bytes match literal goldens and Node validates all variants and page envelopes', () => {
    for (const [i, vector] of replies.entries()) {
      const bytes = printedBytes(output[commands.length * 2 + 1 + i]);
      assert.equal(bytes.toString('hex'), vector.hex, `native production ${vector.kind}`);
      assert.deepEqual(computeCodec.decode(bytes), vector.expected, `Node ${vector.kind}`);
      for (const malformed of [...prefixes(vector.hex), vector.hex + '00', vector.hex + 'ff']) rejectReply(malformed);
    }
    for (const malformed of malformedReplies) rejectReply(malformed);
  });

  await t.test('maximum command and shared snapshot/page reply fit the bounded transport envelope', () => {
    assert.equal(ITEMS_PAGE_CAP, 32);
    assert.equal(COMPUTE_MAX_TOTAL, 512);
    assert.equal(MAX_BODY, 256);
    assert.equal(HEADER_SIZE, 8);
    assert.equal(MAX_PAYLOAD, 248);
    const maximumCommand = Buffer.from('0020' + maxWordsHex, 'hex');
    const maximumReply = Buffer.from('070000002a0000000000000020000000200120' + maxWordsHex, 'hex');
    assert.equal(maximumCommand.length, 130);
    assert.equal(maximumReply.length, 147);
    for (const vector of commands) assert.ok(Buffer.from(vector.hex, 'hex').length <= maximumCommand.length);
    for (const vector of replies) assert.ok(Buffer.from(vector.hex, 'hex').length <= maximumReply.length);
    for (const [kind, payload, hex] of [
      [3, maximumCommand, '0000008a0103000000010001' + maximumCommand.toString('hex')],
      [4, maximumReply, '0000009b0104000000010001' + maximumReply.toString('hex')],
    ] satisfies [3 | 4, Buffer, string][]) {
      assert.ok(HEADER_SIZE + payload.length <= MAX_BODY);
      const frame = { kind, requestId: 1, operationId: 1, payload };
      const encoded = encodeFrame(frame);
      assert.equal(encoded.toString('hex'), hex);
      const decoder = new FrameDecoder();
      const decoded: unknown[] = [];
      decoder.push(encoded, value => decoded.push(value));
      decoder.finish();
      assert.deepEqual(decoded, [frame]);
    }
    assert.equal(encodeFrame({ kind: 3, requestId: 1, operationId: 1, payload: Buffer.alloc(248) }).length, 260);
    assert.throws(() => encodeFrame({ kind: 3, requestId: 1, operationId: 1, payload: Buffer.alloc(249) }));
  });

  const executable = projectPath('build/codecs/compute-portable-acceptance-worker');
  run(bun, [projectPath(`${source}/bend2/main.ts`), projectPath('tests/fixtures/codecs/compute/portable-acceptance-worker.bend'), '-o', executable]);
  const native = await worker(t, { executable, contract: COMPUTE_CONTRACT, profile: 'native-cpu', threads: 1 });
  const raw = (hex: string) => native.call(1, Buffer.from(hex, 'hex'));

  await t.test('actual compiled CPU worker returns thread golden and every malformed command preserves simulation and retained snapshot', async () => {
    const threads = await raw('01');
    assert.equal(threads.toString('hex'), '0100000001');
    assert.deepEqual(computeCodec.decode(threads), { kind: 'threads', value: 1 });
    for (const malformed of [...prefixes('0100000001'), '010000000100', '0100000001ff']) rejectReply(malformed);
    assert.equal((await raw('0002ffffffff00000001')).toString('hex'), '0000000000');
    assert.equal((await raw('0303ffffffff0000000080000000')).toString('hex'), '03030000000080000000ffffffff');
    assert.equal((await raw('02')).toString('hex'), '020400000001000000020000000300000004');
    await raw('07000000002701');
    await raw('0400000007');
    await raw('070100');
    const simulation = '04000000070000000e000000020000';
    assert.equal((await raw('05')).toString('hex'), simulation);
    assert.equal((await raw('0900000003')).toString('hex'), '060000000100000003');
    const pageRequest = '0a000000010000000000000020';
    const page = '07000000010000000000000003000000030103be000000bd80000000000000';
    assert.equal((await raw(pageRequest)).toString('hex'), page);
    assert.deepEqual(computeCodec.decode(Buffer.from(page, 'hex')), {
      kind: 'page', snapshot: 1, offset: 0, total: 3, count: 3, done: true, data: [0xbe000000, 0xbd800000, 0],
    });
    const malformed = new Set([
      ...malformedCommands,
      ...commands.flatMap(({ hex }) => [...prefixes(hex), hex + '00', hex + 'ff']),
    ]);
    for (const hex of malformed) {
      assert.equal((await raw(hex)).toString('hex'), 'ff', `worker rejects ${hex}`);
      assert.equal((await raw('05')).toString('hex'), simulation, `simulation unchanged after ${hex}`);
      assert.equal((await raw(pageRequest)).toString('hex'), page, `snapshot unchanged after ${hex}`);
    }
    assert.equal((await raw('0b00000001')).toString('hex'), '05');
    assert.equal((await raw('0900000000')).toString('hex'), '060000000200000000', 'malformed commands did not consume snapshot IDs');
    assert.equal((await raw('0a000000020000000000000020')).toString('hex'), '07000000020000000000000000000000000100');
  });
});
