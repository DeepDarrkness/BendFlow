import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { createAppClient } from '../../src/client.ts';
import type { CustomOutcome } from '../../contracts/custom.ts';
import { gateway } from '../support/gateways.ts';
import { scratch } from '../support/resources.ts';

async function history(remote: ReturnType<typeof createAppClient>, sessionId: Parameters<typeof remote.custom.command>[0]['sessionId']) {
  const results: CustomOutcome[] = [];
  let total = 0;
  do {
    const reply = await remote.custom.command({ sessionId, command: { kind: 'history', offset: results.length } });
    assert.equal(reply.kind, 'history');
    if (reply.kind !== 'history') throw new Error('Expected history');
    assert.equal(reply.offset, results.length);
    total = reply.total;
    results.push(...reply.results);
  } while (results.length < total);
  return { kind: 'history', results };
}

test('HTTP custom native execution paths preserve failure then success with independent file observations', async t => {
  const dir = await scratch(t, 'bf-custom-http-');
  const server = await gateway(t);
  const remote = createAppClient(server.url);
  const observer = createAppClient(server.url);
  const { sessionId } = await remote.sessions.create({ kind: 'custom' });
  const other = await remote.sessions.create({ kind: 'custom' });
  const results: CustomOutcome[] = [];
  for (let i = 0; i < 2; i++) {
    const failure = await remote.custom.command({ sessionId, command: { kind: 'write', path: join(dir, 'missing', 'file'), text: 'never' } });
    assert.equal(failure.kind, 'fail');
    if (failure.kind !== 'fail') throw new Error('Expected native failure');
    assert.equal(failure.code, 2);
    results.push(failure);
    const path = join(dir, `written-${i}`);
    const text = 'é🙂\0\n'.repeat(18) + '12345';
    const success = { kind: 'written', value: Buffer.byteLength(text) } satisfies CustomOutcome;
    assert.deepEqual(await remote.custom.command({ sessionId, command: { kind: 'write', path, text } }), success);
    assert.deepEqual(await readFile(path), Buffer.from(text));
    results.push(success);
    for (let j = 0; j < 2; j++) assert.deepEqual(await history(observer, sessionId), { kind: 'history', results });
    assert.deepEqual(await history(observer, other.sessionId), { kind: 'history', results: [] });
  }
  const paths: ({ kind: 'immediate'; value: number } | { kind: 'parked'; milliseconds: number; value: number })[] = [{ kind: 'immediate', value: 0xffffffff }, { kind: 'parked', milliseconds: 25, value: 7 }];
  for (const command of paths) {
    const reply = { kind: command.kind, value: command.value } satisfies CustomOutcome;
    assert.deepEqual(await remote.custom.command({ sessionId, command }), reply);
    results.push(reply);
  }
  const path = join(dir, 'marker');
  assert.deepEqual(await remote.custom.command({ sessionId, command: { kind: 'mark', path } }), { kind: 'marked', value: 7 });
  assert.equal(await readFile(path, 'utf8'), 'custom\n');
  results.push({ kind: 'marked', value: 7 });
  assert.deepEqual(await history(observer, sessionId), { kind: 'history', results });
});

test('HTTP custom malformed commands cause no filesystem effect or retained result', async t => {
  const dir = await scratch(t, 'bf-custom-http-');
  const server = await gateway(t);
  const remote = createAppClient(server.url);
  const { sessionId } = await remote.sessions.create({ kind: 'custom' });
  for (const command of [
    { kind: 'mark', path: join(dir, 'forbidden'), extra: true },
    { kind: 'write', path: join(dir, 'forbidden'), text: 'x'.repeat(153) },
    { kind: 'write', path: join(dir, 'forbidden') },
    { kind: 'mark', path: '' }, { kind: 'mark', path: join(dir, 'forbidden') + '\0' },
    { kind: 'parked', milliseconds: 10001, value: 1 }, { kind: 'history', extra: true },
    { kind: 'eval', source: 'uncompiled' },
  ]) {
    const response = await fetch(`${server.url}/custom/command`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ json: { sessionId, command } }), signal: AbortSignal.timeout(3000),
    });
    assert.equal(response.status, 400);
    await response.text();
  }
  assert.deepEqual(await readdir(dir), []);
  assert.deepEqual(await history(remote, sessionId), { kind: 'history', results: [] });
});
