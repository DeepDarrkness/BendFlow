import {
  collectionCommandSchema, collectionReplySchema,
  type CollectionCommand, type CollectionReply,
} from '../../contracts/collection.ts';
import { fileCommandSchema, fileReplySchema, type FileCommand, type FileReply } from '../../contracts/file.ts';
import {
  numericCommandSchema, numericReplySchema, type NumericCommand, type NumericReply,
} from '../../contracts/numeric.ts';
import { BytesReader, BytesWriter, natText, parseNatText } from './bytes.ts';
import { ProtocolError } from './framing.ts';
import { validatedCodec } from '../app.ts';
import { networkCommandSchema, networkReplySchema, type NetworkCommand, type NetworkReply } from '../../contracts/network.ts';
import { taskCommandSchema, taskReplySchema, type TaskCommand, type TaskReply } from '../../contracts/task.ts';
import { processCommandSchema, processReplySchema, type ProcessCommand, type ProcessReply } from '../../contracts/process.ts';
import { computeCommandSchema, computeReplySchema, type ComputeCommand, type ComputeReply } from '../../contracts/compute.ts';
import { customCommandSchema, customReplySchema, type CustomCommand, type CustomReply } from '../../contracts/custom.ts';
export type { NetworkCommand, NetworkReply } from '../../contracts/network.ts';
export type { TaskCommand, TaskReply } from '../../contracts/task.ts';
export type { ProcessCommand, ProcessReply } from '../../contracts/process.ts';
export type { ComputeCommand, ComputeReply } from '../../contracts/compute.ts';
export type { CustomCommand, CustomReply } from '../../contracts/custom.ts';

const ORDER = ['lt', 'eq', 'gt'] as const;

function fail(reader: BytesReader): { kind: 'fail'; code: number; message: string } {
  const code = reader.u32();
  const message = reader.text();
  reader.finish();
  return { kind: 'fail', code, message };
}

function snapshot(reader: BytesReader) {
  return { nat: natText(reader.nat()), total: reader.u32(), count: reader.u32(), f32Bits: reader.u32() };
}

export const NUMERIC_CONTRACT = 'BendFlow/numeric/v1';
export const COLLECTION_CONTRACT = 'BendFlow/collection/v1';
export const FILE_CONTRACT = 'BendFlow/file/v1';
export const NETWORK_CONTRACT = 'BendFlow/network/v1';
export const TASK_CONTRACT = 'BendFlow/task/v1';
export const PROCESS_CONTRACT = 'BendFlow/process/v1';
export const COMPUTE_CONTRACT = 'BendFlow/compute/v1';
export const CUSTOM_CONTRACT = 'BendFlow/custom/v1';

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
      case 'bits': return out.u8(8).u8(command.op).u32(command.left).u32(command.right).toBuffer();
    }
  },
  decode(payload) {
    const reader = new BytesReader(payload);
    const tag = reader.u8();
    if (tag === 255) { reader.finish(); return numericReplySchema.parse({ kind: 'invalidCommand' }); }
    if (tag === 4) { reader.finish(); return { kind: 'invalidText' }; }
    if (tag === 0 || tag === 1) {
      const value = snapshot(reader);
      reader.finish();
      return numericReplySchema.parse({ kind: tag === 0 ? 'value' : 'overflow', value });
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
    throw new ProtocolError('Malformed numeric result');
  },
}, numericReplySchema);

export const collectionCodec = validatedCodec<CollectionCommand, CollectionReply>({
  contract: COLLECTION_CONTRACT,
  parse: input => collectionCommandSchema.parse(input),
  encode(command) {
    const out = new BytesWriter();
    switch (command.kind) {
      case 'put': return out.u8(0).text(command.key).text(command.value).toBuffer();
      case 'get': return out.u8(1).text(command.key).toBuffer();
      case 'del': return out.u8(2).text(command.key).toBuffer();
      case 'setItems': return out.u8(3).u32s(command.items).toBuffer();
      case 'mapInc': return out.u8(4).toBuffer();
      case 'sort': return out.u8(5).toBuffer();
      case 'arraySet': return out.u8(6).u32(command.index).u32(command.value).toBuffer();
      case 'arrayGet': return out.u8(7).u32(command.index).toBuffer();
      case 'read': return out.u8(8).toBuffer();
    }
  },
  decode(payload) {
    const reader = new BytesReader(payload);
    const tag = reader.u8();
    if (tag === 255) { reader.finish(); return { kind: 'invalidCommand' }; }
    if (tag === 0) { reader.finish(); return { kind: 'ok' }; }
    if (tag === 1) { const text = reader.text(); reader.finish(); return { kind: 'text', text }; }
    if (tag === 2) { reader.finish(); return { kind: 'missing' }; }
    if (tag === 3) { const text = reader.text(); reader.finish(); return { kind: 'deleted', text }; }
    if (tag === 4) { const value = reader.u32(); reader.finish(); return { kind: 'cell', value }; }
    if (tag === 5) { const items = reader.u32s(); reader.finish(); return collectionReplySchema.parse({ kind: 'items', items }); }
    throw new ProtocolError('Malformed collection result');
  },
}, collectionReplySchema);

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
    throw new ProtocolError('Malformed file result');
  },
}, fileReplySchema);

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
    throw new ProtocolError('Malformed network result');
  },
}, networkReplySchema);

export const taskCodec = validatedCodec<TaskCommand, TaskReply>({
  contract: TASK_CONTRACT,
  parse: input => taskCommandSchema.parse(input),
  encode(command) {
    const out = new BytesWriter();
    switch (command.kind) {
      case 'nap': return out.u8(0).u32(command.ms).toBuffer();
      case 'start': return out.u8(1).u32(command.ms).text(command.text, 64).toBuffer();
      case 'join': return out.u8(2).u32(command.id).toBuffer();
      case 'timeout': return out.u8(3).u32(command.limit).u32(command.ms).text(command.text, 32).toBuffer();
    }
  },
  decode(payload) {
    const reader = new BytesReader(payload);
    const tag = reader.u8();
    if (tag === 255) { reader.finish(); return { kind: 'invalidCommand' }; }
    if (tag === 0 && reader.remaining() === 0) return { kind: 'ok' };
    if (tag === 0) { const id = reader.u32(); reader.finish(); return { kind: 'started', id }; }
    if (tag === 1) { const text = reader.text(); reader.finish(); return { kind: 'text', text }; }
    if (tag === 3) { reader.finish(); return { kind: 'missing' }; }
    if (tag === 5) { reader.finish(); return { kind: 'timeout' }; }
    throw new ProtocolError('Malformed task result');
  },
}, taskReplySchema);

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
