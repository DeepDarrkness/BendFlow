import { processCommandSchema, processReplySchema, type ProcessCommand, type ProcessReply } from '../../../contracts/process.ts';
import { BytesReader, BytesWriter } from '../bytes.ts';
import { validatedCodec } from '../codec.ts';
import { ProtocolError } from '../framing.ts';
import { fail } from './shared.ts';

export const PROCESS_CONTRACT = 'BendFlow/process/v1';

export const processCodec = validatedCodec<ProcessCommand, ProcessReply>({
  contract: PROCESS_CONTRACT,
  parse: input => processCommandSchema.parse(input),
  encode(command) {
    const out = new BytesWriter();
    switch (command.kind) {
      case 'env': return out.u8(0).text(command.name).toBuffer();
      case 'args': return out.u8(1).toBuffer();
      case 'run': return out.u8(2).text(command.program).text(command.arg, 64).text(command.input, 64).toBuffer();
      case 'random': return out.u8(3).toBuffer();
    }
  },
  decode(payload) {
    const reader = new BytesReader(payload);
    const tag = reader.u8();
    if (tag === 255) { reader.finish(); return { kind: 'invalidCommand' }; }
    if (tag === 1) { const text = reader.text(); reader.finish(); return { kind: 'text', text }; }
    if (tag === 2) return fail(reader);
    if (tag === 3) {
      const code = reader.u32();
      const stdout = reader.text();
      const stderr = reader.text();
      reader.finish();
      return { kind: 'run', code, stdout, stderr };
    }
    if (tag === 4) { const value = reader.u32(); reader.finish(); return { kind: 'random', value }; }
    throw new ProtocolError('Malformed process result');
  },
}, processReplySchema);
