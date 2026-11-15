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
    if (tag === 5) { const items = reader.u32s(); reader.finish(); return { kind: 'items', items }; }
    throw new ProtocolError('Malformed collection result');
  },
}, collectionReplySchema);
