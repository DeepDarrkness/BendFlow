import { MAX_PAYLOAD, ProtocolError } from './framing.ts';

export const MAX_NAT = (1n << 48n) - 1n;
export const MAX_TEXT = 96;
export const MAX_BYTES = 192;
export const MAX_ITEMS = 32;

export class BytesReader {
  #buffer: Buffer;
  #offset = 0;

  constructor(buffer: Buffer) {
    this.#buffer = buffer;
  }

  remaining(): number {
    return this.#buffer.length - this.#offset;
  }

  u8(): number {
    const value = this.#buffer[this.#offset];
    if (value === undefined) throw new ProtocolError('Truncated byte');
    this.#offset += 1;
    return value;
  }

  u16(): number {
    if (this.remaining() < 2) throw new ProtocolError('Truncated u16');
    const value = this.#buffer.readUInt16BE(this.#offset);
    this.#offset += 2;
    return value;
  }

  u32(): number {
    if (this.remaining() < 4) throw new ProtocolError('Truncated u32');
    const value = this.#buffer.readUInt32BE(this.#offset);
    this.#offset += 4;
    return value;
  }

  nat(): bigint {
    if (this.remaining() < 6) throw new ProtocolError('Truncated nat');
    const high = this.#buffer.readUInt16BE(this.#offset);
    const low = this.#buffer.readUInt32BE(this.#offset + 2);
    this.#offset += 6;
    return (BigInt(high) << 32n) | BigInt(low);
  }

  bytes(max = MAX_BYTES): Buffer {
    const length = this.u8();
    if (length > max) throw new ProtocolError('Byte sequence exceeds bound');
    if (this.remaining() < length) throw new ProtocolError('Truncated bytes');
    const value = Buffer.from(this.#buffer.subarray(this.#offset, this.#offset + length));
    this.#offset += length;
    return value;
  }

  text(max = MAX_TEXT): string {
    const value = this.bytes(max);
    const text = value.toString('utf8');
    if (Buffer.byteLength(text, 'utf8') !== value.length) throw new ProtocolError('Invalid UTF-8');
    return text;
  }

  u32s(max = MAX_ITEMS): number[] {
    const count = this.u8();
    if (count > max) throw new ProtocolError('Item list exceeds bound');
    const items = [];
    for (let i = 0; i < count; i++) items.push(this.u32());
    return items;
  }

  finish(): void {
    if (this.remaining() !== 0) throw new ProtocolError('Trailing bytes');
  }
}

export class BytesWriter {
  #chunks: Buffer[] = [];
  #size = 0;

  #push(chunk: Buffer): void {
    if (this.#size + chunk.length > MAX_PAYLOAD) throw new ProtocolError('Frame exceeds 256-byte body limit');
    this.#chunks.push(chunk);
    this.#size += chunk.length;
  }

  u8(value: number): this {
    if (!Number.isInteger(value) || value < 0 || value > 255) throw new ProtocolError('Invalid u8');
    this.#push(Buffer.from([value]));
    return this;
  }

  u16(value: number): this {
    if (!Number.isInteger(value) || value < 0 || value > 0xffff) throw new ProtocolError('Invalid u16');
    const chunk = Buffer.alloc(2);
    chunk.writeUInt16BE(value);
    this.#push(chunk);
    return this;
  }

  u32(value: number): this {
    if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) throw new ProtocolError('Invalid u32');
    const chunk = Buffer.alloc(4);
    chunk.writeUInt32BE(value);
    this.#push(chunk);
    return this;
  }

  nat(value: bigint): this {
    if (value < 0n || value > MAX_NAT) throw new ProtocolError('Nat exceeds native limit');
    const chunk = Buffer.alloc(6);
    chunk.writeUInt16BE(Number(value >> 32n), 0);
    chunk.writeUInt32BE(Number(value & 0xffffffffn), 2);
    this.#push(chunk);
    return this;
  }

  bytes(value: Uint8Array, max = MAX_BYTES): this {
    if (value.length > max) throw new ProtocolError('Byte sequence exceeds bound');
    this.u8(value.length);
    this.#push(Buffer.from(value));
    return this;
  }

  text(value: string, max = MAX_TEXT): this {
    const encoded = Buffer.from(value, 'utf8');
    if (encoded.length > max) throw new ProtocolError('Text exceeds bound');
    return this.bytes(encoded, max);
  }

  u32s(items: number[], max = MAX_ITEMS): this {
    if (items.length > max) throw new ProtocolError('Item list exceeds bound');
    this.u8(items.length);
    for (const item of items) this.u32(item);
    return this;
  }

  toBuffer(): Buffer {
    return Buffer.concat(this.#chunks, this.#size);
  }
}

export function f32Bits(value: number): number {
  const buffer = Buffer.alloc(4);
  buffer.writeFloatBE(value);
  return buffer.readUInt32BE();
}

export function f32FromBits(bits: number): number {
  if (!Number.isInteger(bits) || bits < 0 || bits > 0xffffffff) throw new ProtocolError('Invalid F32 bits');
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(bits);
  return buffer.readFloatBE();
}

export function natText(value: bigint): string {
  if (value < 0n || value > MAX_NAT) throw new ProtocolError('Nat exceeds native limit');
  return value.toString(10);
}

export function parseNatText(value: string): bigint {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new ProtocolError('Invalid Nat text');
  const parsed = BigInt(value);
  if (parsed > MAX_NAT) throw new ProtocolError('Nat exceeds native limit');
  return parsed;
}
