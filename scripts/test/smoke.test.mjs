import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';

test('npm-installed dependencies work', () => {
  const message = z.object({ status: z.literal('ok') });
  assert.deepEqual(message.parse({ status: 'ok' }), { status: 'ok' });
  assert.equal(message.safeParse({ status: 'failed' }).success, false);
});
