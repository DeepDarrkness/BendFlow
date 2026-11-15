export type AppCodec<Command, Reply> = {
  contract: string;
  parse: (input: unknown) => Command;
  encode: (command: Command) => Buffer;
  decode: (payload: Buffer) => Reply;
};

const validatedEncoders = new WeakSet<object>();

export function validatedCodec<Command, Reply>(
  codec: AppCodec<Command, Reply>, reply: { parse: (input: unknown) => Reply },
): AppCodec<Command, Reply> {
  const encode = (command: Command) => codec.encode(codec.parse(command));
  validatedEncoders.add(encode);
  return {
    ...codec,
    encode,
    decode: payload => reply.parse(codec.decode(payload)),
  };
}

export function encodeCommand<Command, Reply>(codec: AppCodec<Command, Reply>, command: Command): Buffer {
  // Custom codecs still need parsing; validated encoders already own that boundary.
  return codec.encode(validatedEncoders.has(codec.encode) ? command : codec.parse(command));
}
