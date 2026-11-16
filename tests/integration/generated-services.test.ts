import assert from 'node:assert/strict';
import test from 'node:test';
import { buildServices } from '../../scripts/build/services.ts';
import { NativeApp } from '../../src/app.ts';
import { projectPath } from '../../src/paths.ts';
import { ServiceHost, ServiceLimitError, ServiceLookupError, ServiceWaitError } from '../../src/service-host.ts';
import { external } from '../support/subprocess.ts';
import { WorkerError } from '../../src/worker.ts';
import { createServer } from 'node:http';
import { listen } from '../support/servers.ts';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

test('generated counter uses native retained state and exact codecs with normal finalization', async t => {
  buildServices({ entry: projectPath('examples/services/counter.bend'), out: projectPath('build/services') });
  const { counterCodec } = await import('../../build/services/native.ts');
  assert.deepEqual(counterCodec.encode({ request: { amount: 0x01020304 } }), Buffer.from([1, 2, 3, 4]));
  assert.deepEqual(counterCodec.decode(Buffer.from([0, 1, 2, 3, 4])), { value: 0x01020304 });
  const app = await NativeApp.start(counterCodec, { executable: projectPath('build/services/native/worker-counter') });
  t.after(() => app.close());
  assert.deepEqual(await app.command({ request: { amount: 7 } }), { value: 7 });
  assert.deepEqual(await app.raw(Buffer.from([0, 0, 2])), Buffer.from([255]));
  assert.deepEqual(await app.raw(Buffer.from([0, 0, 0, 9, 0])), Buffer.from([255]));
  assert.deepEqual(await app.command({ request: { amount: 0 } }), { value: 7 });
  assert.deepEqual(await app.command({ request: { amount: 0xffffffff } }), { value: 6 });
  assert.deepEqual(await app.command({ request: { amount: 1 } }), { value: 7 });
  await app.close();
  await app.close();
  assert.equal(app.diagnostics.split('counter finalized').length - 1, 1);
  assert.throws(() => process.kill(app.pid, 0), { code: 'ESRCH' });
  await assert.rejects(NativeApp.start({ ...counterCodec, contract: 'BendFlow/service/v1/stale' }, {
    executable: projectPath('build/services/native/worker-counter'),
  }), WorkerError);
});

test('active native failure rejects waiting invocations and never recreates the session', async t => {
  const { counterService } = await import('../../build/services/native.ts');
  const host = new ServiceHost([counterService]);
  t.after(() => host.close());
  const { sessionId } = await host.create('counter');
  const active = assert.rejects(host.invoke(counterService, sessionId, { request: { amount: 7 } }), WorkerError);
  const waiting = assert.rejects(host.invoke(counterService, sessionId, { request: { amount: 100 } }), WorkerError);
  const pid = host.workerPids[0];
  if (!pid) throw new Error('Expected a native service process');
  process.kill(pid, 'SIGKILL');
  await Promise.all([active, waiting]);
  await assert.rejects(host.invoke(counterService, sessionId, { request: { amount: 0 } }), ServiceLookupError);
  await host.close();
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
});

test('shutdown during service startup closes the acquired native instance', async () => {
  const { counterService } = await import('../../build/services/native.ts');
  const acquired: number[] = [];
  const service = { ...counterService, start: async (...args: Parameters<typeof counterService.start>) => {
    const app = await counterService.start(...args);
    acquired.push(app.pid);
    return app;
  } };
  const host = new ServiceHost([service]);
  const creating = assert.rejects(host.create(service.name), ServiceLookupError);
  await host.close();
  await creating;
  assert.equal(acquired.length, 1);
  for (const pid of acquired) assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
});

test('generated client validates replies against its generated output contract', async t => {
  const { createClient, sessionIdSchema } = await import('../../build/services/index.ts');
  const port = await listen(t, createServer((_, response) => {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ json: { value: 'not a U32' } }));
  }));
  const client = createClient(`http://127.0.0.1:${port}/rpc`);
  await assert.rejects(client.counter({ sessionId: sessionIdSchema.parse('00000000-0000-4000-8000-000000000000'),
    args: { request: { amount: 7 } } }), /Malformed generated endpoint reply/);
});

test('service builds emit deterministic contracts and failed generation preserves the complete package', async t => {
  const root = mkdtempSync(projectPath('build/service-build-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const first = resolve(root, 'first');
  const second = resolve(root, 'second');
  const entry = projectPath('examples/services/counter.bend');
  buildServices({ entry, out: first });
  buildServices({ entry, out: second });
  for (const file of ['contract.ts', 'native.ts', 'client.ts', 'server.ts', 'description.json', 'worker-counter.bend', 'worker-accumulate.bend']) {
    assert.equal(readFileSync(resolve(first, file), 'utf8'), readFileSync(resolve(second, file), 'utf8'), file);
  }
  const before = readFileSync(resolve(first, 'build.json'), 'utf8');
  assert.throws(() => buildServices({ entry: projectPath('tests/fixtures/services/not-data.bend'), out: first }), /must be declared is Data/);
  assert.equal(readFileSync(resolve(first, 'build.json'), 'utf8'), before);
});

test('generated native endpoints support closed generic state and service names that resemble runtime imports', async t => {
  const root = mkdtempSync(projectPath('build/service-name-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const fixture of ['generic-state', 'import-names']) {
    const out = resolve(root, fixture);
    buildServices({ entry: projectPath(`tests/fixtures/services/${fixture}.bend`), out });
    const methods = fixture === 'generic-state' ? ['counter'] : ['validated', 'define'];
    const child = await external(process.execPath, ['--input-type=module', '-e', `
      import { startGateway, createClient } from ${JSON.stringify(resolve(out, 'index.ts'))};
      const gateway = await startGateway();
      try {
        const client = createClient(gateway.url);
        const replies = [];
        for (const method of ${JSON.stringify(methods)}) {
          const { sessionId } = await client.sessions.create({ service: method });
          replies.push(await client[method]({ sessionId, args: { request: { amount: 7 } } }));
          await client.sessions.close({ sessionId });
        }
        process.stdout.write(JSON.stringify(replies));
      } finally { await gateway.close(); }
    `]);
    assert.equal(child.stderr, '');
    assert.deepEqual(JSON.parse(child.stdout), fixture === 'generic-state' ? [{ value: 7 }] : [{ value: 37 }, { value: 81 }]);
  }
});

test('generated typed HTTP endpoints retain Bend state across external clients and isolate sessions', async t => {
  const { startGateway, createClient } = await import('../../build/services/index.ts');
  const gateway = await startGateway();
  t.after(() => gateway.close());
  const first = createClient(gateway.url);
  const second = createClient(gateway.url);
  const shared = await first.sessions.create({ service: 'counter' });
  const isolated = await second.sessions.create({ service: 'counter' });
  assert.deepEqual(await first.counter({ sessionId: shared.sessionId, args: { request: { amount: 7 } } }), { value: 7 });
  const child = await external(process.execPath, ['--input-type=module', '-e', `
    import { createClient } from ${JSON.stringify(projectPath('build/services/client.ts'))};
    const client = createClient(${JSON.stringify(gateway.url)});
    process.stdout.write(JSON.stringify(await client.counter(${JSON.stringify({ sessionId: shared.sessionId, args: { request: { amount: 5 } } })})));
  `]);
  assert.equal(child.stderr, '');
  assert.deepEqual(JSON.parse(child.stdout), { value: 12 });
  const concurrent = await Promise.all([
    first.counter({ sessionId: shared.sessionId, args: { request: { amount: 1 } } }),
    second.counter({ sessionId: shared.sessionId, args: { request: { amount: 2 } } }),
  ]);
  const observed = concurrent.map(reply => reply.value).sort((a, b) => a - b);
  assert.equal(observed[1], 15);
  assert.ok(observed[0] === 13 || observed[0] === 14);
  assert.deepEqual(await second.counter({ sessionId: isolated.sessionId, args: { request: { amount: 0 } } }), { value: 0 });
  const meter = await first.sessions.create({ service: 'accumulate' });
  assert.deepEqual(await first.accumulate({ sessionId: meter.sessionId, args: { sample: { delta: 3, weight: 2 } } }), { running: 16, calls: 1 });
  assert.deepEqual(await second.accumulate({ sessionId: meter.sessionId, args: { sample: { delta: 4, weight: 3 } } }), { running: 28, calls: 2 });
  await assert.rejects(first.accumulate({ sessionId: shared.sessionId, args: { sample: { delta: 0, weight: 1 } } }), { code: 'NOT_FOUND' });
  for (const request of [{ amount: -1 }, { amount: 0.5 }, { amount: 0x100000000 }, { amount: 2, extra: 1 }]) {
    const response = await fetch(`${gateway.url}/counter`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ json: { sessionId: shared.sessionId, args: { request } } }) });
    assert.equal(response.status, 400);
    await response.text();
  }
  const raw = await fetch(`${gateway.url}/counter`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ json: { sessionId: shared.sessionId, args: { request: { amount: 0 } } } }) });
  assert.equal(raw.status, 200);
  assert.deepEqual(await raw.json(), { json: { value: 15 } });
  const pids = gateway.workerPids;
  await first.sessions.close({ sessionId: shared.sessionId });
  await second.sessions.close({ sessionId: shared.sessionId });
  await assert.rejects(first.counter({ sessionId: shared.sessionId, args: { request: { amount: 0 } } }), { code: 'NOT_FOUND' });
  await gateway.close();
  for (const pid of pids) assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
});

test('generated service queue bounds waiting work, preserves admission order, and drains active work on close', async t => {
  const { counterService } = await import('../../build/services/native.ts');
  const host = new ServiceHost([counterService], { maxWaiting: 1 });
  t.after(() => host.close());
  const { sessionId } = await host.create('counter');
  const active = host.invoke(counterService, sessionId, { request: { amount: 7 } });
  const abort = new AbortController();
  const waiting = host.invoke(counterService, sessionId, { request: { amount: 100 } }, { signal: abort.signal });
  const aborted = assert.rejects(waiting, { name: 'AbortError' });
  await assert.rejects(host.invoke(counterService, sessionId, { request: { amount: 1000 } }), ServiceLimitError);
  abort.abort();
  await aborted;
  assert.deepEqual(await active, { value: 7 });
  const first = host.invoke(counterService, sessionId, { request: { amount: 3 } });
  const next = host.invoke(counterService, sessionId, { request: { amount: 5 } });
  assert.deepEqual(await Promise.all([first, next]), [{ value: 10 }, { value: 15 }]);
  const last = host.invoke(counterService, sessionId, { request: { amount: 1 } });
  const rejected = assert.rejects(host.invoke(counterService, sessionId, { request: { amount: 100 } }), ServiceLookupError);
  const closed = host.closeSession(sessionId);
  await rejected;
  assert.deepEqual(await last, { value: 16 });
  await closed;
  assert.equal(host.workerPids.length, 0);
});

test('waiting expiration never mutates the native service state', async t => {
  const { counterService } = await import('../../build/services/native.ts');
  const host = new ServiceHost([counterService], { waitMs: 5 });
  t.after(() => host.close());
  const { sessionId } = await host.create('counter');
  const active = host.invoke(counterService, sessionId, { request: { amount: 7 } });
  await assert.rejects(host.invoke(counterService, sessionId, { request: { amount: 100 } }), ServiceWaitError);
  await active;
  assert.deepEqual(await host.invoke(counterService, sessionId, { request: { amount: 0 } }), { value: 7 });
});
