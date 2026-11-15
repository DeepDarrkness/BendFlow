import assert from 'node:assert/strict';
import test from 'node:test';
import { CONTRACT, encodeFrame, FrameDecoder, ProtocolError, type Frame } from '../../src/protocol/framing.ts';

const golden = Buffer.from('0000000b010301020304ffff0080ff', 'hex');
const frame: Frame = { kind: 3, requestId: 0x01020304, operationId: 65535, payload: Buffer.from([0, 128, 255]) };

test('hand-specified golden vectors define the envelope and handshake', () => {
  assert.deepEqual(encodeFrame(frame), golden);
  assert.equal(encodeFrame({ kind: 1, requestId: 0, operationId: 0, payload: CONTRACT }).toString('hex'),
    '00000018010100000000000042656e64466c6f772f6563686f2f7631');
  assert.equal(encodeFrame({ kind: 2, requestId: 0, operationId: 0, payload: CONTRACT }).toString('hex'),
    '00000018010200000000000042656e64466c6f772f6563686f2f7631');
  assert.equal(encodeFrame({ kind: 4, requestId: 0xffffffff, operationId: 65535, payload: Buffer.alloc(0) }).toString('hex'),
    '000000080104ffffffffffff');
});

test('Node decodes every split and byte-at-a-time delivery', () => {
  for (let split = 0; split <= golden.length; split++) {
    const decoder = new FrameDecoder();
    const received: Frame[] = [];
    decoder.push(golden.subarray(0, split), f => received.push(f));
    decoder.push(golden.subarray(split), f => received.push(f));
    decoder.finish();
    assert.deepEqual(received, [frame]);
  }
  const decoder = new FrameDecoder();
  const received: Frame[] = [];
  for (const byte of golden) decoder.push(Buffer.from([byte]), f => received.push(f));
  assert.deepEqual(received, [frame]);
});

test('Node decodes coalesced frames with bounded per-frame storage', () => {
  const decoder = new FrameDecoder();
  let count = 0;
  decoder.push(Buffer.concat(Array.from({ length: 10_000 }, () => golden)), received => {
    assert.deepEqual(received, frame);
    count++;
  });
  assert.equal(count, 10_000);
  decoder.finish();
});

test('Node accepts maximum frame and rejects oversized payloads/lengths and undersized headers', () => {
  const maximum = { ...frame, payload: Buffer.alloc(248, 255) };
  const decoder = new FrameDecoder();
  const received: Frame[] = [];
  decoder.push(encodeFrame(maximum), f => received.push(f));
  assert.deepEqual(received, [maximum]);
  assert.throws(() => encodeFrame({ ...frame, payload: Buffer.alloc(249) }), ProtocolError);
  for (const length of [0, 7, 257, 0xffffffff]) {
    const prefix = Buffer.alloc(4);
    prefix.writeUInt32BE(length);
    assert.throws(() => new FrameDecoder().push(prefix, () => {}), ProtocolError);
  }
});

test('Node rejects every truncated prefix/body, invalid version and kind', () => {
  for (let length = 1; length < golden.length; length++) {
    const decoder = new FrameDecoder();
    decoder.push(golden.subarray(0, length), () => {});
    assert.throws(() => decoder.finish(), /EOF/);
  }
  for (const [offset, value] of [[4, 2], [5, 0], [5, 5], [5, 255]]) {
    if (offset === undefined || value === undefined) throw new Error('Invalid vector');
    const bytes = Buffer.from(golden);
    bytes[offset] = value;
    const decoder = new FrameDecoder();
    assert.throws(() => decoder.push(bytes, () => {}), ProtocolError);
    assert.throws(() => decoder.push(golden, () => {}), /already failed/);
  }
});

test('encoding rejects fractional, negative and out-of-range identifiers', () => {
  for (const requestId of [-1, 1.5, 0x100000000, NaN, Infinity]) {
    assert.throws(() => encodeFrame({ ...frame, requestId }), /Invalid request ID/);
  }
  for (const operationId of [-1, 1.5, 65536, NaN, Infinity]) {
    assert.throws(() => encodeFrame({ ...frame, operationId }), /Invalid operation ID/);
  }
});
