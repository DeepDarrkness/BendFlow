export const MAX_BODY = 256;
export const HEADER_SIZE = 8;
export const MAX_PAYLOAD = MAX_BODY - HEADER_SIZE;
export const VERSION = 1;
export const CONTRACT = Buffer.from('BendFlow/echo/v1', 'ascii');
export const ECHO_OPERATION = 0xffff;

export type MessageKind = 1 | 2 | 3 | 4;
export type Frame = {
  kind: MessageKind;
  requestId: number;
  operationId: number;
  payload: Buffer;
};

export class ProtocolError extends Error {}

export function encodeFrame(frame: Frame): Buffer {
  for (const [value, max, name] of [
    [frame.requestId, 0xffffffff, 'request ID'], [frame.operationId, 0xffff, 'operation ID'],
    [frame.kind, 4, 'message kind'],
  ] satisfies [number, number, string][]) {
    if (!Number.isInteger(value) || value < 0 || value > max || (name === 'message kind' && value === 0)) {
      throw new ProtocolError(`Invalid ${name}`);
    }
  }
  const length = HEADER_SIZE + frame.payload.length;
  if (length > MAX_BODY) throw new ProtocolError('Frame exceeds 256-byte body limit');
  const bytes = Buffer.alloc(4 + length);
  bytes.writeUInt32BE(length, 0);
  bytes.writeUInt8(VERSION, 4);
  bytes.writeUInt8(frame.kind, 5);
  bytes.writeUInt32BE(frame.requestId, 6);
  bytes.writeUInt16BE(frame.operationId, 10);
  frame.payload.copy(bytes, 12);
  return bytes;
}

function decodeBody(body: Buffer): Frame {
  if (body[0] !== VERSION) throw new ProtocolError('Unsupported protocol version');
  const kind = body[1];
  if (kind !== 1 && kind !== 2 && kind !== 3 && kind !== 4) {
    throw new ProtocolError('Unknown message kind');
  }
  return {
    kind, requestId: body.readUInt32BE(2), operationId: body.readUInt16BE(6),
    payload: Buffer.from(body.subarray(8)),
  };
}

export class FrameDecoder {
  #buffer = Buffer.alloc(4 + MAX_BODY);
  #used = 0;
  #target = 4;
  #failed = false;

  push(chunk: Buffer, onFrame: (frame: Frame) => void): void {
    if (this.#failed) throw new ProtocolError('Decoder is already failed');
    try {
      let offset = 0;
      while (offset < chunk.length) {
        const count = Math.min(this.#target - this.#used, chunk.length - offset);
        chunk.copy(this.#buffer, this.#used, offset, offset + count);
        offset += count;
        this.#used += count;
        if (this.#used !== this.#target) continue;
        if (this.#target === 4) {
          const length = this.#buffer.readUInt32BE(0);
          if (length < HEADER_SIZE || length > MAX_BODY) throw new ProtocolError('Invalid frame body length');
          this.#target = 4 + length;
        } else {
          const frame = decodeBody(this.#buffer.subarray(4, this.#target));
          this.#used = 0;
          this.#target = 4;
          onFrame(frame);
        }
      }
    } catch (error) {
      this.#failed = true;
      throw error;
    }
  }

  finish(): void {
    if (this.#used !== 0) throw new ProtocolError('EOF inside a frame');
  }
}
