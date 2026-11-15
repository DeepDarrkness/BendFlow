import assert from 'node:assert/strict';
import test from 'node:test';
import { numericCodec } from '../../src/protocol/apps.ts';

test('numeric codec agrees with hand-specified command bytes', () => {
  assert.equal(numericCodec.encode({ kind: 'read' }).toString('hex'), '02');
  assert.equal(numericCodec.encode({ kind: 'reset' }).toString('hex'), '03');
  assert.equal(numericCodec.encode({ kind: 'add', amount: 7 }).toString('hex'), '0100000007');
  assert.equal(numericCodec.encode({ kind: 'accumulate', amount: '7' }).toString('hex'), '00000000000007');
});
