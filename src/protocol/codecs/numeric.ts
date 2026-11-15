import {
  numericCommandSchema, numericReplySchema, type NumericCommand, type NumericReply,
  arithmeticOps, comparisonOps, bitOps, conversionOps,
} from '../../../contracts/numeric.ts';
import { BytesReader, BytesWriter, natText, parseNatText } from '../bytes.ts';
import { validatedCodec } from '../codec.ts';
import { ProtocolError } from '../framing.ts';

const ORDER: ('lt' | 'eq' | 'gt')[] = ['lt', 'eq', 'gt'];

function snapshot(reader: BytesReader) {
  return { nat: natText(reader.nat()), total: reader.u32(), count: reader.u32(), f32Bits: reader.u32() };
}

export const NUMERIC_CONTRACT = 'BendFlow/numeric/v1';

export const numericCodec = validatedCodec<NumericCommand, NumericReply>({
  contract: NUMERIC_CONTRACT,
  parse: input => numericCommandSchema.parse(input),
  encode(command) {
    const out = new BytesWriter();
    switch (command.kind) {
      case 'accumulate': return out.u8(0).nat(parseNatText(command.amount)).toBuffer();
      case 'add': return out.u8(1).u32(command.amount).toBuffer();
      case 'read': return out.u8(2).toBuffer();
      case 'reset': return out.u8(3).toBuffer();
      case 'parse': return out.u8(4).text(command.text).toBuffer();
      case 'show': return out.u8(5).toBuffer();
      case 'f32Add': return out.u8(6).u32(command.left).u32(command.right).toBuffer();
      case 'compare': return out.u8(7).nat(parseNatText(command.left)).nat(parseNatText(command.right)).toBuffer();
      case 'bits': return out.u8(8).u8(typeof command.op === 'number' ? command.op : bitOps.indexOf(command.op)).u32(command.left).u32(command.right).toBuffer();
      case 'calculate':
      case 'compareNumber': {
        out.u8(command.kind === 'calculate' ? 9 : 11)
          .u8(['nat', 'u32', 'f32'].indexOf(command.domain))
          .u8(command.kind === 'calculate' ? arithmeticOps.indexOf(command.op) : comparisonOps.indexOf(command.op));
        return command.domain === 'nat'
          ? out.nat(parseNatText(command.left)).nat(parseNatText(command.right)).toBuffer()
          : out.u32(command.left).u32(command.right).toBuffer();
      }
      case 'convert': {
        out.u8(10).u8(conversionOps.indexOf(command.op));
        return typeof command.value === 'string' ? out.nat(parseNatText(command.value)).toBuffer() : out.u32(command.value).toBuffer();
      }
      case 'bool': return out.u8(12).u8(['and', 'or', 'xor', 'not'].indexOf(command.op)).u8(Number(command.left)).u8(Number(command.right)).toBuffer();
    }
  },
  decode(payload) {
    const reader = new BytesReader(payload);
    const tag = reader.u8();
    if (tag === 255) { reader.finish(); return { kind: 'invalidCommand' }; }
    if (tag === 4) { reader.finish(); return { kind: 'invalidText' }; }
    if (tag === 0 || tag === 1) {
      const value = snapshot(reader);
      reader.finish();
      return { kind: tag === 0 ? 'value' : 'overflow', value };
    }
    if (tag === 5) {
      const text = reader.text();
      reader.finish();
      return { kind: 'text', text };
    }
    if (tag === 6) {
      const order = ORDER[reader.u8()];
      if (!order) throw new ProtocolError('Malformed numeric result');
      reader.finish();
      return { kind: 'order', order };
    }
    if (tag === 7) {
      const value = reader.u32();
      reader.finish();
      return { kind: 'bits', value };
    }
    if (tag === 8) {
      const value = natText(reader.nat()); reader.finish(); return { kind: 'nat', value };
    }
    if (tag === 9) {
      const value = reader.u8();
      if (value > 1) throw new ProtocolError('Malformed numeric boolean');
      reader.finish(); return { kind: 'bool', value: value === 1 };
    }
    if (tag === 10) {
      const reasons: ('overflow' | 'divisionByZero' | 'outOfRange')[] = ['overflow', 'divisionByZero', 'outOfRange'];
      const reason = reasons[reader.u8()];
      if (!reason) throw new ProtocolError('Malformed arithmetic error');
      reader.finish(); return { kind: 'arithmeticError', reason };
    }
    throw new ProtocolError('Malformed numeric result');
  },
}, numericReplySchema);
