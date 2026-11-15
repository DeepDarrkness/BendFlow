import {
  collectionCommandSchema, collectionReplySchema,
  type CollectionCommand, type CollectionReply,
} from '../../../contracts/collection.ts';
import { BytesReader, BytesWriter } from '../bytes.ts';
import { validatedCodec } from '../codec.ts';
import { ProtocolError } from '../framing.ts';

export const COLLECTION_CONTRACT = 'BendFlow/collection/v1';

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
      case 'arrayRead': return out.u8(23).toBuffer();
      case 'read': return out.u8(8).toBuffer();
      case 'appendItems': return out.u8(9).u32s(command.items).toBuffer();
      case 'capture': return out.u8(10).toBuffer();
      case 'page': return out.u8(11).u32(command.snapshot).u32(command.offset).u32(command.max).toBuffer();
      case 'release': return out.u8(12).u32(command.snapshot).toBuffer();
      case 'putNested': {
        const r = command.record;
        return out.u8(13).text(r.name, 24).text(r.choice.kind === 'text' ? r.choice.text : '', 24)
          .u32s([r.point[0], r.point[1], r.optional === null ? 0 : 1, r.optional ?? 0, r.choice.kind === 'number' ? 0 : 1, r.choice.kind === 'number' ? r.choice.value : 0, ...r.items], 22).toBuffer();
      }
      case 'getNested': return out.u8(14).toBuffer();
      case 'set': return out.u8(15).text(command.add, 24).text(command.remove, 24).text(command.has, 24).toBuffer();
      case 'fold': return out.u8(16).toBuffer();
      case 'transform': return out.u8(17).u32(command.value).text(command.text, 24).toBuffer();
      case 'storeClosure': return out.u8(18).u32(command.amount).toBuffer();
      case 'consumeClosure': return out.u8(19).u32(command.value).toBuffer();
      case 'sized': return out.u8(20).toBuffer();
      case 'maybe': return out.u8(21).text(command.left, 24).text(command.right, 24).toBuffer();
      case 'result': return out.u8(22).text(command.left, 24).text(command.right, 24).toBuffer();
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
    if (tag === 5) { const items = reader.u32s(); reader.finish(); return { kind: 'items', items }; }
    if (tag === 6) { const snapshot = reader.u32(); const total = reader.u32(); reader.finish(); return { kind: 'snapshot', snapshot, total }; }
    if (tag === 7) {
      const snapshot = reader.u32(), offset = reader.u32(), total = reader.u32(), count = reader.u32(), flag = reader.u8();
      if (flag > 1) throw new ProtocolError('Invalid completion flag');
      const data = reader.u32s(); reader.finish(); return { kind: 'page', snapshot, offset, total, count, done: flag === 1, data };
    }
    if (tag >= 8 && tag <= 11) { reader.finish(); return { kind: tag === 8 ? 'stale' : tag === 9 ? 'invalidOffset' : tag === 10 ? 'limit' : 'exhausted' }; }
    if (tag === 12) {
      const name = reader.text(24), text = reader.text(24), values = reader.u32s(22);
      reader.finish();
      const [x, y, present, optional, choice, number, ...items] = values;
      if (x === undefined || y === undefined || optional === undefined || number === undefined ||
          (present !== 0 && present !== 1) || (choice !== 0 && choice !== 1) ||
          (present === 0 && optional !== 0) || (choice === 0 && text !== '') || (choice === 1 && number !== 0)) throw new ProtocolError('Invalid nested record');
      return { kind: 'nested', record: { name, point: [x, y], optional: present === 0 ? null : optional,
        choice: choice === 0 ? { kind: 'number', value: number } : { kind: 'text', text }, items } };
    }
    if (tag === 13) { const size = reader.u32(), flag = reader.u8(); reader.finish(); if (flag > 1) throw new ProtocolError('Invalid set flag'); return { kind: 'set', size, has: flag === 1 }; }
    if (tag === 14) { const a = reader.u32(), b = reader.u32(), c = reader.u32(), text = reader.text(24); reader.finish(); return { kind: 'transformed', values: [a,b,c], text }; }
    if (tag === 15) { const flag = reader.u8(); if (flag > 1) throw new ProtocolError('Invalid Maybe flag'); const value = flag === 0 ? null : reader.u32(); reader.finish(); return { kind: 'maybe', value }; }
    if (tag === 16) { const value = reader.u32(); reader.finish(); return { kind: 'result', value }; }
    if (tag === 17) { const flag = reader.u8(); reader.finish(); if (flag > 1) throw new ProtocolError('Invalid Result error'); return { kind: 'resultError', error: flag === 0 ? 'left' : 'right' }; }
    throw new ProtocolError('Malformed collection result');
  },
}, collectionReplySchema);
