import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanupPriority, ResourceOwner, resources } from '../support/resources.ts';

test('test resources close native processes before peers and directories regardless of acquisition order', async t => {
  assert.equal(resources(t), resources(t));
  const owner = new ResourceOwner();
  const closed: string[] = [];
  owner.add(cleanupPriority.directory, () => { closed.push('directory'); });
  owner.add(cleanupPriority.peer, () => { closed.push('peer'); });
  owner.add(cleanupPriority.native, async () => { closed.push('native'); });
  const closing = owner.close();
  assert.equal(owner.close(), closing);
  await closing;
  assert.deepEqual(closed, ['native', 'peer', 'directory']);
});

test('test cleanup attempts every resource and aggregates rejection, throw, and deadline failures', async () => {
  const owner = new ResourceOwner();
  const attempted: string[] = [];
  const rejected = new Error('native failure');
  const thrown = new Error('peer failure');
  owner.add(cleanupPriority.native, () => { attempted.push('native'); return Promise.reject(rejected); });
  owner.add(cleanupPriority.peer, () => { attempted.push('peer'); throw thrown; });
  owner.add(cleanupPriority.peer, () => { attempted.push('stalled'); return new Promise<void>(() => {}); }, 20);
  owner.add(cleanupPriority.directory, () => { attempted.push('directory'); });
  await assert.rejects(owner.close(), error => {
    assert.ok(error instanceof AggregateError);
    assert.equal(error.errors.length, 3);
    assert.equal(error.errors[0], rejected);
    assert.equal(error.errors[1], thrown);
    assert.match(String(error.errors[2]), /Test deadline exceeded/);
    return true;
  });
  assert.deepEqual(attempted, ['native', 'peer', 'stalled', 'directory']);
});
