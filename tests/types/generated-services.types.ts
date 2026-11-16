import { createClient, sessionIdSchema, type counterReply } from '../../build/services/index.ts';

function checkClient() {
  const client = createClient('http://127.0.0.1:1/rpc');
  const sessionId = sessionIdSchema.parse('00000000-0000-4000-8000-000000000000');
  const reply: Promise<counterReply> = client.counter({ sessionId, args: { request: { amount: 7 } } });
  void client.accumulate({ sessionId, args: { sample: { delta: 3, weight: 2 } } });
  void client.sessions.create({ service: 'counter' });
  // @ts-expect-error U32 input is numeric.
  void client.counter({ sessionId, args: { request: { amount: '7' } } });
  // @ts-expect-error The generated request requires amount.
  void client.counter({ sessionId, args: { request: {} } });
  // @ts-expect-error Internal state is not an endpoint argument.
  void client.counter({ sessionId, args: { state: { total: 7 }, request: { amount: 0 } } });
  // @ts-expect-error The second service has different generated fields.
  void client.accumulate({ sessionId, args: { request: { amount: 7 } } });
  // @ts-expect-error Lifecycle declarations are not endpoints.
  void client.lifecycle.init.counter();
  // @ts-expect-error Service creation accepts only generated exports.
  void client.sessions.create({ service: 'missing' });
  // @ts-expect-error The reply does not expose internal state fields.
  void reply.then(value => value.total);
  return reply;
}

void checkClient;
