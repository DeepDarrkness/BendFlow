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
    switch (command.kind) {
      case 'sum': return out.u8(0).u32s(command.items).toBuffer();
      case 'threads': return out.u8(1).toBuffer();
      case 'frame': return out.u8(2).toBuffer();
      case 'sort': return out.u8(3).u32s(command.items).toBuffer();
      case 'advance': return out.u8(4).u32(command.steps).toBuffer();
      case 'inspect': return out.u8(5).toBuffer();
      case 'reset': return out.u8(6).toBuffer();
      case 'event': {
        out.u8(7);
        switch (command.event.kind) {
          case 'key': return out.u8(0).u32(command.event.code).u8(Number(command.event.down)).toBuffer();
          case 'focus': return out.u8(1).u8(Number(command.event.on)).toBuffer();
          case 'close': return out.u8(2).toBuffer();
          default: { const exhaustive: never = command.event; return exhaustive; }
        }
      }
      case 'render': return out.u8(8).u32(command.depth).toBuffer();
      case 'samples': return out.u8(9).u32(command.count).toBuffer();
      case 'page': return out.u8(10).u32(command.snapshot).u32(command.offset).u32(command.max).toBuffer();
      case 'release': return out.u8(11).u32(command.snapshot).toBuffer();
      default: { const exhaustive: never = command; return exhaustive; }
    }
  },
  decode(payload) {
    const reader = new BytesReader(payload);
    const tag = reader.u8();
    if (tag === 255) { reader.finish(); return { kind: 'invalidCommand' }; }
    if (tag === 0) { const value = reader.u32(); reader.finish(); return { kind: 'sum', value }; }
    if (tag === 1) { const value = reader.u32(); reader.finish(); return { kind: 'threads', value }; }
    if (tag === 2) { const items = reader.u32s(); reader.finish(); return { kind: 'pixels', items }; }
    if (tag === 3) { const items = reader.u32s(); reader.finish(); return { kind: 'sorted', items }; }
    const bool = () => { const n = reader.u8(); if (n > 1) throw new ProtocolError('Invalid compute boolean'); return n === 1; };
    if (tag === 4) { const tick = reader.u32(), position = reader.u32(), velocity = reader.u32(), running = bool(), closed = bool(); reader.finish(); return { kind: 'simulation', tick, position, velocity, running, closed }; }
    if (tag === 5) { reader.finish(); return { kind: 'ok' }; }
    if (tag === 6) { const snapshot = reader.u32(), total = reader.u32(); reader.finish(); return { kind: 'snapshot', snapshot, total }; }
    if (tag === 7) { const snapshot = reader.u32(), offset = reader.u32(), total = reader.u32(), count = reader.u32(), done = bool(), data = reader.u32s(); reader.finish(); return { kind: 'page', snapshot, offset, total, count, done, data }; }
    if (tag === 8) {
      const reasons: Extract<ComputeReply, { kind: 'error' }>['reason'][] = ['busy', 'stale', 'range', 'exhausted', 'overflow'];
      const reason = reasons[reader.u8()]; reader.finish();
      if (reason === undefined) throw new ProtocolError('Invalid compute error');
      return { kind: 'error', reason };
    }
    throw new ProtocolError('Malformed compute result');
  },
}, computeReplySchema);
