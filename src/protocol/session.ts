import { replySchema, type Command, type SessionReply } from '../../contracts/session.ts';
import { ProtocolError } from './framing.ts';

export const SESSION_CONTRACT = 'BendFlow/session/v1';
export const STEP_OPERATION = 1;

export function encodeCommand(command: Command): Buffer {
  switch (command.kind) {
    case 'add': {
      const payload = Buffer.alloc(5);
      payload[0] = 0;
      payload.writeUInt32BE(command.amount, 1);
      return payload;
    }
    case 'read': return Buffer.from([1]);
    case 'reset': return Buffer.from([2]);
    default: {
      const exhaustive: never = command;
      throw new ProtocolError(`Unsupported command: ${exhaustive}`);
    }
  }
}

export function decodeReply(payload: Buffer): SessionReply {
  if (payload.length === 1 && payload[0] === 2) return { kind: 'invalidCommand' };
  if (payload.length !== 9 || (payload[0] !== 0 && payload[0] !== 1)) {
    throw new ProtocolError('Malformed session result');
  }
  return replySchema.parse({
    kind: payload[0] === 0 ? 'value' : 'overflow',
    value: { total: payload.readUInt32BE(1), acceptedAdds: payload.readUInt32BE(5) },
  });
}
