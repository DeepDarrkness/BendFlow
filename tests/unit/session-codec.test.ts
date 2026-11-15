import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeReply, encodeCommand } from '../../src/protocol/session.ts';

test('session codec agrees with hand-specified command and result bytes', () => {
  assert.equal(encodeCommand({ kind: 'add', amount: 7 }).toString('hex'), '0000000007');
  assert.equal(encodeCommand({ kind: 'add', amount: 0xffffffff }).toString('hex'), '00ffffffff');
  assert.equal(encodeCommand({ kind: 'read' }).toString('hex'), '01');
  assert.equal(encodeCommand({ kind: 'reset' }).toString('hex'), '02');
  assert.deepEqual(decodeReply(Buffer.from('000000000700000001', 'hex')), { kind: 'value', value: { total: 7, acceptedAdds: 1 } });
  assert.deepEqual(decodeReply(Buffer.from('01ffffffff00000002', 'hex')), { kind: 'overflow', value: { total: 0xffffffff, acceptedAdds: 2 } });
  assert.deepEqual(decodeReply(Buffer.from('02', 'hex')), { kind: 'invalidCommand' });
  for (const hex of ['', '00', '03', '0200', '00000000070000000100', '030000000700000001']) {
    assert.throws(() => decodeReply(Buffer.from(hex, 'hex')), /Malformed session result/);
  }
});
