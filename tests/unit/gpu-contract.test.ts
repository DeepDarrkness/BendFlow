import assert from 'node:assert/strict';
import test from 'node:test';
import { createSessionSchema, createdSessionSchema, executionSchema, sessionIdSchema } from '../../contracts/apps.ts';
import { SESSION_KINDS } from '../../contracts/kinds.ts';
import { capabilities } from '../../src/kinds.ts';
import { runtimeArgs } from '../../src/runtime.ts';

test('GPU execution is a strict compute-only session profile', () => {
  const execution = { profile: 'gpu' };
  assert.deepEqual(executionSchema.parse(execution), execution);
  assert.deepEqual(createSessionSchema.parse({ kind: 'compute', execution }), { kind: 'compute', execution });
  for (const kind of SESSION_KINDS.filter(kind => kind !== 'compute')) {
    assert.equal(createSessionSchema.safeParse({ kind, execution }).success, false, kind);
  }
  for (const invalid of [{ profile: 'gpu', threads: 1 }, { profile: 'gpu', executable: '/other' }, { profile: 'graphics-audio' }]) {
    assert.equal(executionSchema.safeParse(invalid).success, false);
    assert.equal(createSessionSchema.safeParse({ kind: 'compute', execution: invalid }).success, false);
  }
  assert.equal(createSessionSchema.safeParse({ kind: 'compute', execution, extra: true }).success, false);
  const sessionId = sessionIdSchema.parse('01234567-89ab-4cde-8fab-0123456789ab');
  assert.deepEqual(createdSessionSchema.parse({ sessionId, kind: 'compute', execution }), { sessionId, kind: 'compute', execution });
  assert.deepEqual(runtimeArgs('gpu'), ['+RTS', '--threads', '1', '--gpu', 'on', '-RTS']);
});

test('CPU session defaults and thread limits remain valid for every kind', () => {
  for (const kind of SESSION_KINDS) {
    assert.deepEqual(createSessionSchema.parse({ kind }), { kind, execution: { profile: 'native-cpu' } });
    for (const threads of [2, 64]) {
      const execution = { profile: 'multithreaded-cpu', threads };
      assert.deepEqual(createSessionSchema.parse({ kind, execution }), { kind, execution });
    }
    for (const threads of [1, 65, 2.5]) {
      assert.equal(createSessionSchema.safeParse({ kind, execution: { profile: 'multithreaded-cpu', threads } }).success, false);
    }
  }
});

test('Default capabilities require GPU evidence and explicitly exclude native window and audio', () => {
  const profiles = capabilities().profiles;
  assert.equal(profiles.find(row => row.profile === 'gpu')?.status, 'unavailable');
  assert.deepEqual(profiles.find(row => row.profile === 'graphics-audio'), {
    profile: 'graphics-audio', status: 'excluded', scope: 'phase2',
    reason: 'Native window and audio effects are excluded from the agreed Phase 2 scope',
  });
});
