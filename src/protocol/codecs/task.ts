import { taskCommandSchema, taskReplySchema, type TaskCommand, type TaskReply } from '../../../contracts/task.ts';
import { BytesReader, BytesWriter } from '../bytes.ts';
import { validatedCodec } from '../codec.ts';
import { ProtocolError } from '../framing.ts';

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
