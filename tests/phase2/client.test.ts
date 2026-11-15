import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { createAppClient } from '../../src/client.ts';
import { sessionIdSchema } from '../../contracts/apps.ts';

test('typed HTTP client rejects malformed successful replies instead of trusting declared types', async t => {
  const server = createServer((_request, response) => {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ json: { kind: 'value', value: { nat: 'invalid', total: -1, count: 0, f32Bits: 0 } } }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve, reject) => {
    server.closeAllConnections();
    server.close(error => error ? reject(error) : resolve());
  }));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected HTTP fixture');
  const remote = createAppClient(`http://127.0.0.1:${address.port}/rpc`);
  await assert.rejects(remote.numeric.command({
    sessionId: sessionIdSchema.parse('00000000-0000-4000-8000-000000000000'), command: { kind: 'read' },
  }), /Malformed gateway reply/);
});
