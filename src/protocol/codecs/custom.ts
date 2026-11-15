import { customCommandSchema, customReplySchema, type CustomCommand, type CustomReply, type CustomOutcome } from '../../../contracts/custom.ts';
import { BytesReader, BytesWriter } from '../bytes.ts';
import { validatedCodec } from '../codec.ts';
import { ProtocolError } from '../framing.ts';

export const CUSTOM_CONTRACT = 'BendFlow/custom/v1';

function outcome(reader: BytesReader, tag: number): CustomOutcome {
  if (tag === 2) return { kind: 'fail', code: reader.u32(), message: reader.text() };
  const kinds = { 0: 'marked', 1: 'immediate', 3: 'written', 4: 'parked' } satisfies Record<number, CustomOutcome['kind']>;
  if (tag === 0 || tag === 1 || tag === 3 || tag === 4) return { kind: kinds[tag], value: reader.u32() };
  throw new ProtocolError('Malformed custom outcome');
}

export const customCodec = validatedCodec<CustomCommand, CustomReply>({
  contract: CUSTOM_CONTRACT,
  parse: input => customCommandSchema.parse(input),
  encode(command) {
    const writer = new BytesWriter();
    switch (command.kind) {
      case 'mark': return writer.u8(0).text(command.path).toBuffer();
      case 'immediate': return writer.u8(1).u32(command.value).toBuffer();
      case 'write': return writer.u8(3).text(command.path).text(command.text, 149).toBuffer();
      case 'parked': return writer.u8(4).u32(command.milliseconds).u32(command.value).toBuffer();
      case 'history': return writer.u8(5).u32(command.offset).toBuffer();
    }
  },
  decode(payload) {
    const reader = new BytesReader(payload);
    const tag = reader.u8();
    if (tag === 255) { reader.finish(); return { kind: 'invalidCommand' }; }
    if (tag === 5) {
      const offset = reader.u32();
      const total = reader.u32();
      const count = reader.u8();
      if (count > 2) throw new ProtocolError('Custom history page exceeds bound');
      const results = Array.from({ length: count }, () => outcome(reader, reader.u8()));
      reader.finish();
      return { kind: 'history', offset, total, results };
    }
    const result = outcome(reader, tag);
    reader.finish();
    return result;
  },
}, customReplySchema);
