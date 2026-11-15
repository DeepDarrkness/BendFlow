import { customCommandSchema, customReplySchema, type CustomCommand, type CustomReply } from '../../../contracts/custom.ts';
import { BytesReader, BytesWriter } from '../bytes.ts';
import { validatedCodec } from '../codec.ts';
import { ProtocolError } from '../framing.ts';
import { fail } from './shared.ts';

export const CUSTOM_CONTRACT = 'BendFlow/custom/v1';

export const customCodec = validatedCodec<CustomCommand, CustomReply>({
  contract: CUSTOM_CONTRACT,
  parse: input => customCommandSchema.parse(input),
  encode: command => new BytesWriter().u8(0).text(command.path).toBuffer(),
  decode(payload) {
    const reader = new BytesReader(payload);
    const tag = reader.u8();
    if (tag === 255) { reader.finish(); return { kind: 'invalidCommand' }; }
    if (tag === 0) { const value = reader.u32(); reader.finish(); return { kind: 'marked', value }; }
    if (tag === 2) return fail(reader);
    throw new ProtocolError('Malformed custom result');
  },
}, customReplySchema);
