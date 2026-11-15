import { z } from 'zod';
import { RPCLink } from '@orpc/client/fetch';
import { bytes, MAX_BYTES } from '../../contracts/values.ts';

const byteArray = z.array(z.number().int().min(0).max(255)).max(MAX_BYTES);

export const byteSerializer = {
  type: 1000,
  condition: (value: unknown) => value instanceof Uint8Array,
  serialize: (value: unknown) => Array.from(bytes().parse(value)),
  deserialize: (value: unknown) => Uint8Array.from(byteArray.parse(value)),
} satisfies NonNullable<ConstructorParameters<typeof RPCLink>[0]['customJsonSerializers']>[number];
