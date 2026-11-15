import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import type { ContractRouterClient } from '@orpc/contract';
import { getContractRouter, isContractProcedure } from '@orpc/contract';
import { appsContract } from '../contracts/apps.ts';
import { byteSerializer } from './protocol/json.ts';
import { ProtocolError } from './protocol/framing.ts';

export function createAppClient(url: string): ContractRouterClient<typeof appsContract> {
  const link = new RPCLink({
    url, customJsonSerializers: [byteSerializer],
    fetch: (request, init) => fetch(request, {
      ...init, signal: AbortSignal.any([request.signal, AbortSignal.timeout(5000)]),
    }),
  });
  return createORPCClient<ContractRouterClient<typeof appsContract>>({
    async call(path, input, options) {
      const procedure = getContractRouter(appsContract, path);
      if (!procedure || !isContractProcedure(procedure)) throw new ProtocolError('Unknown gateway operation');
      const result = await link.call(path, input, options);
      try {
        const validated = await procedure['~orpc'].outputSchema?.['~standard'].validate(result);
        if (!validated || validated.issues) throw new Error('Reply failed its contract');
        return validated.value;
      }
      catch (error) { throw new ProtocolError('Malformed gateway reply', { cause: error }); }
    },
  });
}
