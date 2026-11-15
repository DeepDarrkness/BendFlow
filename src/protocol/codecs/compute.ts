import { computeCommandSchema, computeReplySchema, type ComputeCommand, type ComputeReply } from '../../../contracts/compute.ts';
import { BytesReader, BytesWriter } from '../bytes.ts';
import { validatedCodec } from '../codec.ts';
import { ProtocolError } from '../framing.ts';

export const COMPUTE_CONTRACT = 'BendFlow/compute/v1';

export const computeCodec = validatedCodec<ComputeCommand, ComputeReply>({
  contract: COMPUTE_CONTRACT,
  parse: input => computeCommandSchema.parse(input),
  encode(command) {
    const out = new BytesWriter();
    if (command.kind === 'sum') return out.u8(0).u32s(command.items).toBuffer();
    if (command.kind === 'threads') return out.u8(1).toBuffer();
    return out.u8(2).toBuffer();
  },
  decode(payload) {
    const reader = new BytesReader(payload);
    const tag = reader.u8();
    if (tag === 255) { reader.finish(); return { kind: 'invalidCommand' }; }
    if (tag === 0) { const value = reader.u32(); reader.finish(); return { kind: 'sum', value }; }
    if (tag === 1) { const value = reader.u32(); reader.finish(); return { kind: 'threads', value }; }
    if (tag === 2) { const items = reader.u32s(); reader.finish(); return { kind: 'pixels', items }; }
    throw new ProtocolError('Malformed compute result');
  },
}, computeReplySchema);
