import type { ContractRouterClient } from '@orpc/contract';
import { sessionContract, type SessionReply } from '../contracts/session.ts';

function checkClient(client: ContractRouterClient<typeof sessionContract>): Promise<SessionReply> {
  const response: Promise<SessionReply> = client.command({ kind: 'add', amount: 7 });
  // @ts-expect-error Add requires an amount.
  void client.command({ kind: 'add' });
  // @ts-expect-error Read accepts no extra fields.
  void client.command({ kind: 'read', amount: 7 });
  // @ts-expect-error The gateway exposes statically compiled commands only.
  void client.command({ kind: 'eval', source: 'arbitrary code' });
  return response;
}

void checkClient;
