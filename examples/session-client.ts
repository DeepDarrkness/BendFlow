import assert from 'node:assert/strict';
import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import type { ContractRouterClient } from '@orpc/contract';
import { sessionContract, type Command } from '../contracts/session.ts';

const url = process.argv[2];
if (!url) throw new Error('Usage: node examples/session-client.ts http://127.0.0.1:PORT/rpc');
const client: ContractRouterClient<typeof sessionContract> = createORPCClient(new RPCLink({ url }));
const commands: Command[] = [
  { kind: 'add', amount: 7 }, { kind: 'add', amount: 7 }, { kind: 'add', amount: 7 },
  { kind: 'read' }, { kind: 'reset' }, { kind: 'add', amount: 5 },
];
const expected = [
  { total: 7, acceptedAdds: 1 }, { total: 14, acceptedAdds: 2 }, { total: 21, acceptedAdds: 3 },
  { total: 21, acceptedAdds: 3 }, { total: 0, acceptedAdds: 0 }, { total: 5, acceptedAdds: 1 },
];
for (const [index, command] of commands.entries()) {
  const result = await client.command(command, { signal: AbortSignal.timeout(5000) });
  assert.deepEqual(result, { kind: 'value', value: expected[index] });
  process.stdout.write(JSON.stringify({ clientPid: process.pid, command, result }) + '\n');
}
