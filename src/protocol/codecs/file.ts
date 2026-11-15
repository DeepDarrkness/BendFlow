import { fileCommandSchema, fileReplySchema, type FileCommand, type FileReply } from '../../../contracts/file.ts';
import { BytesReader, BytesWriter } from '../bytes.ts';
import { validatedCodec } from '../codec.ts';
import { ProtocolError } from '../framing.ts';
import { fail } from './shared.ts';

export const FILE_CONTRACT = 'BendFlow/file/v1';

export const fileCodec = validatedCodec<FileCommand, FileReply>({
  contract: FILE_CONTRACT,
  parse: input => fileCommandSchema.parse(input),
  encode(command) {
    const out = new BytesWriter();
    switch (command.kind) {
      case 'open': return out.u8(0).text(command.path).text(command.mode, 8).toBuffer();
      case 'write': return out.u8(1).u32(command.id).bytes(command.bytes).toBuffer();
      case 'read': return out.u8(2).u32(command.id).u32(command.max).toBuffer();
      case 'size': return out.u8(3).u32(command.id).toBuffer();
      case 'readAt': return out.u8(4).u32(command.id).u32(command.offset).u32(command.max).toBuffer();
      case 'writeAt': return out.u8(5).u32(command.id).u32(command.offset).bytes(command.bytes).toBuffer();
      case 'close': return out.u8(6).u32(command.id).toBuffer();
      case 'capture': return out.u8(7).u32(command.id).toBuffer();
      case 'page': return out.u8(8).u32(command.snapshot).u32(command.offset).u32(command.max).toBuffer();
      case 'release': return out.u8(9).u32(command.snapshot).toBuffer();
    }
  },
  decode(payload) {
    const reader = new BytesReader(payload);
    const tag = reader.u8();
    if (tag === 255) { reader.finish(); return { kind: 'invalidCommand' }; }
    if (tag === 0 && reader.remaining() === 0) return { kind: 'ok' };
    if (tag === 0) { const id = reader.u32(); reader.finish(); return { kind: 'opened', id }; }
    if (tag === 1) { const bytes = reader.bytes(); reader.finish(); return { kind: 'bytes', bytes }; }
    if (tag === 2) return fail(reader);
    if (tag === 3) { reader.finish(); return { kind: 'missing' }; }
    if (tag === 4) { const value = reader.u32(); reader.finish(); return { kind: 'size', value }; }
    if (tag === 6) { const snapshot = reader.u32(); const total = reader.u32(); reader.finish(); return { kind: 'snapshot', snapshot, total }; }
    if (tag === 7) {
      const snapshot = reader.u32(), offset = reader.u32(), total = reader.u32(), count = reader.u32(), flag = reader.u8();
      if (flag > 1) throw new ProtocolError('Invalid completion flag');
      const data = reader.bytes(); reader.finish(); return { kind: 'page', snapshot, offset, total, count, done: flag === 1, data };
    }
    if (tag >= 8 && tag <= 11) { reader.finish(); return { kind: tag === 8 ? 'stale' : tag === 9 ? 'invalidOffset' : tag === 10 ? 'limit' : 'exhausted' }; }
    throw new ProtocolError('Malformed file result');
  },
}, fileReplySchema);
