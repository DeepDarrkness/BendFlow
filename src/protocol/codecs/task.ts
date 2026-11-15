import { taskCommandSchema, taskReplySchema, type TaskCommand, type TaskReply } from '../../../contracts/task.ts';
import { BytesReader, BytesWriter } from '../bytes.ts';
import { validatedCodec } from '../codec.ts';
import { ProtocolError } from '../framing.ts';
import { fail } from './shared.ts';

export const TASK_CONTRACT = 'BendFlow/task/v1';

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
      case 'channels': return out.u8(4).text(command.text, 64).toBuffer();
      case 'openFile': return out.u8(5).text(command.path).toBuffer();
      case 'writeFile': return out.u8(6).text(command.text, 64).toBuffer();
      case 'transfer': return out.u8(7).text(command.text, 64).toBuffer();
      case 'release': return out.u8(8).toBuffer();
      case 'collect': return out.u8(9).toBuffer();
      case 'closeFile': return out.u8(10).toBuffer();
    }
  },
  decode(payload) {
    const reader = new BytesReader(payload);
    const tag = reader.u8();
    if (tag === 255) { reader.finish(); return { kind: 'invalidCommand' }; }
    if (tag === 0 && reader.remaining() === 0) return { kind: 'ok' };
    if (tag === 0) { const id = reader.u32(); reader.finish(); return { kind: 'started', id }; }
    if (tag === 1) { const text = reader.text(); reader.finish(); return { kind: 'text', text }; }
    if (tag === 2) return fail(reader);
    if (tag === 3) { reader.finish(); return { kind: 'missing' }; }
    if (tag === 5) { reader.finish(); return { kind: 'timeout' }; }
    throw new ProtocolError('Malformed task result');
  },
}, taskReplySchema);
