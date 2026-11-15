import assert from 'node:assert/strict';
import test from 'node:test';
import { createAppClient } from '../../src/client.ts';
import { COMPUTE_MAX_TOTAL, computeReplySchema, type ComputeCommand } from '../../contracts/compute.ts';
import { collectSnapshot } from '../../contracts/pages.ts';
import { f32FromBits } from '../../src/protocol/bytes.ts';
import { projectPath } from '../../src/paths.ts';
import { gateway } from '../support/gateways.ts';
import { external } from '../support/subprocess.ts';

test('HTTP compute external clients share simulation and retained pages with isolation and recovery', async t => {
  const server = await gateway(t);
  const client = createAppClient(server.url);
  const { sessionId } = await client.sessions.create({ kind: 'compute', execution: { profile: 'multithreaded-cpu', threads: 2 } });
  const child = async (command: ComputeCommand) => {
    const program = `import { createAppClient } from ${JSON.stringify(projectPath('src/client.ts'))}; const c = createAppClient(${JSON.stringify(server.url)}); const reply = await c.compute.command(${JSON.stringify({ sessionId, command })}); process.stdout.write(JSON.stringify(reply));`;
    const result = await external(process.execPath, ['--input-type=module', '-e', program], { timeout: 10000 });
    assert.equal(result.stderr, '');
    return computeReplySchema.parse(JSON.parse(result.stdout));
  };
  assert.deepEqual(await child({ kind: 'threads' }), { kind: 'threads', value: 2 });
  assert.deepEqual(await child({ kind: 'sum', items: [0xffffffff, 1, 9] }), { kind: 'sum', value: 9 });
  assert.deepEqual(await child({ kind: 'sort', items: [9, 0, 9, 1] }), { kind: 'sorted', items: [0, 1, 9, 9] });
  await child({ kind: 'event', event: { kind: 'key', code: 39, down: true } });
  assert.deepEqual(await child({ kind: 'advance', steps: 3 }), { kind: 'simulation', tick: 3, position: 6, velocity: 2, running: true, closed: false });
  const captured = await child({ kind: 'render', depth: 3 });
  if (captured.kind !== 'snapshot') throw new Error('expected snapshot');
  assert.deepEqual(await child({ kind: 'samples', count: 33 }), { kind: 'error', reason: 'busy' });
  await child({ kind: 'reset' });
  const words = await collectSnapshot({ descriptor: captured, totalLimit: COMPUTE_MAX_TOTAL, pageCap: 32,
    read: (offset, max) => child({ kind: 'page', snapshot: captured.snapshot, offset, max }),
  });
  assert.deepEqual(words, Array.from({ length: 64 }, (_, i) => {
    const x = (i & 1) | ((i >> 1) & 2) | ((i >> 2) & 4);
    const y = ((i >> 1) & 1) | ((i >> 2) & 2) | ((i >> 3) & 4);
    return (((x + 6) << 24) | ((y + 3) << 16) | ((x + 17 * y + 93) % 256 << 8) | 255) >>> 0;
  }));
  assert.deepEqual(await child({ kind: 'release', snapshot: captured.snapshot }), { kind: 'ok' });
  assert.deepEqual(await child({ kind: 'page', snapshot: captured.snapshot, offset: 0, max: 32 }), { kind: 'error', reason: 'stale' });
  const samples = await child({ kind: 'samples', count: 33 });
  if (samples.kind !== 'snapshot') throw new Error('expected samples');
  assert.ok(samples.snapshot > captured.snapshot);
  const first = await child({ kind: 'page', snapshot: samples.snapshot, offset: 0, max: 32 });
  if (first.kind !== 'page') throw new Error('expected page');
  assert.equal(first.data[0], 0xbf800000);
  const final = await child({ kind: 'page', snapshot: samples.snapshot, offset: 32, max: 32 });
  assert.deepEqual(final, { kind: 'page', snapshot: samples.snapshot, offset: 32, total: 33, count: 1, done: true, data: [0xbf800000] });
  await child({ kind: 'advance', steps: 1 });
  await child({ kind: 'reset' });
  const sampleWords = await collectSnapshot({ descriptor: samples, totalLimit: COMPUTE_MAX_TOTAL, pageCap: 17,
    read: (offset, max) => child({ kind: 'page', snapshot: samples.snapshot, offset, max }),
  });
  assert.deepEqual(sampleWords.map(f32FromBits), Array.from({ length: 33 }, (_, i) => (i % 32) / 16 - 1));
  const isolated = await client.sessions.create({ kind: 'compute' });
  await child({ kind: 'advance', steps: 1 });
  assert.deepEqual(await client.compute.command({ sessionId: isolated.sessionId, command: { kind: 'inspect' } }), { kind: 'simulation', tick: 0, position: 0, velocity: 1, running: true, closed: false });
  for (const command of [{ kind: 'render', depth: 5 }, { kind: 'samples', count: 513 }, { kind: 'page', snapshot: 1, offset: 0, max: 0 }]) {
    const response = await fetch(`${server.url}/compute/command`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ json: { sessionId, command } }) });
    assert.equal(response.status, 400); await response.text();
  }
  assert.equal((await child({ kind: 'inspect' })).kind, 'simulation');
  await client.sessions.close({ sessionId }); await client.sessions.close({ sessionId });
  await assert.rejects(client.compute.command({ sessionId, command: { kind: 'inspect' } }), { code: 'NOT_FOUND' });
});
