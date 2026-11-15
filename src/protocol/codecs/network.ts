import { networkCommandSchema, networkReplySchema, type NetworkCommand, type NetworkReply } from '../../../contracts/network.ts';
import { BytesReader, BytesWriter } from '../bytes.ts';
import { validatedCodec } from '../codec.ts';
import { ProtocolError } from '../framing.ts';
import { fail } from './shared.ts';

export const NETWORK_CONTRACT = 'BendFlow/network/v1';

export const networkCodec = validatedCodec<NetworkCommand, NetworkReply>({
  contract: NETWORK_CONTRACT,
  parse: input => networkCommandSchema.parse(input),
  encode(command) {
    const out = new BytesWriter();
    switch (command.kind) {
      case 'connect': return out.u8(0).text(command.host, 64).u32(command.port).toBuffer();
      case 'send': return out.u8(1).u32(command.id).bytes(command.bytes).toBuffer();
      case 'recv': return out.u8(2).u32(command.id).u32(command.max).toBuffer();
      case 'close': return out.u8(3).u32(command.id).toBuffer();
      case 'bind': return out.u8(4).text(command.host, 64).u32(command.port).toBuffer();
      case 'sendTo': return out.u8(5).u32(command.id).text(command.host, 64).u32(command.port).bytes(command.bytes, 96).toBuffer();
      case 'recvFrom': return out.u8(6).u32(command.id).u32(command.max).u32(command.ms).toBuffer();
      case 'listen': return out.u8(7).text(command.host, 64).u32(command.port).toBuffer();
      case 'accept': return out.u8(8).u32(command.id).toBuffer();
      case 'tryAccept': return out.u8(9).u32(command.id).u32(command.ms).toBuffer();
      case 'tryRecv': return out.u8(10).u32(command.id).u32(command.max).u32(command.ms).toBuffer();
      case 'trySend': return out.u8(11).u32(command.id).bytes(command.bytes).u32(command.ms).toBuffer();
      case 'trySendTo': return out.u8(12).u32(command.id).text(command.host, 64).u32(command.port).bytes(command.bytes, 96).u32(command.ms).toBuffer();
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
    if (tag === 5) { reader.finish(); return { kind: 'eof' }; }
    if (tag === 6) {
      const host = reader.text();
      const port = reader.u32();
      const bytes = reader.bytes();
      reader.finish();
      return { kind: 'dgram', host, port, bytes };
    }
    if (tag === 7) { reader.finish(); return { kind: 'timeout' }; }
    if (tag === 8) { const code = reader.u32(); const unsent = reader.bytes(); reader.finish(); return { kind: 'sendFailure', code, unsent }; }
    if (tag === 9) { const unsent = reader.bytes(); reader.finish(); return { kind: 'sendTimeout', unsent }; }
    if (tag === 10) { reader.finish(); return { kind: 'wrongResource' }; }
    if (tag === 11) { reader.finish(); return { kind: 'exhausted' }; }
    throw new ProtocolError('Malformed network result');
  },
}, networkReplySchema);
