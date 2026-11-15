import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test, { type TestContext } from 'node:test';
import { NativeApp } from '../../src/app.ts';
import { processCodec } from '../../src/protocol/apps.ts';
import { assertGone, bounded } from '../helpers.ts';

const executable = resolve('build/process-worker');

async function app(t: TestContext, env: NodeJS.ProcessEnv = {}) {
  const session = await NativeApp.start(processCodec, { executable, env, callMs: 4000 });
  t.after(async () => { await bounded(session.close()); assertGone(session.pid); });
  return session;
}

test('process session reads fixture environment and arguments', async t => {
  const session = await app(t, { BENDFLOW_PROBE: 'ok' });
  assert.deepEqual(await session.command({ kind: 'env', name: 'BENDFLOW_PROBE' }), { kind: 'text', text: 'ok' });
  const args = await session.command({ kind: 'args' });
  assert.equal(args.kind, 'text');
  if (args.kind !== 'text') throw new Error('expected text');
  assert.match(args.text, /process-worker/);
});

test('process.run reports fixture exit status, stdout, and stderr', async t => {
  const session = await app(t);
  const echoed = await session.command({ kind: 'run', program: '/bin/echo', arg: 'ok', input: '' });
  assert.equal(echoed.kind, 'run');
  if (echoed.kind !== 'run') throw new Error('expected run');
  assert.equal(echoed.code, 0);
  assert.match(echoed.stdout, /ok/);
  const failed = await session.command({ kind: 'run', program: '/bin/ls', arg: '/no-such-bendflow', input: '' });
  assert.equal(failed.kind, 'run');
  if (failed.kind !== 'run') throw new Error('expected run');
  assert.notEqual(failed.code, 0);
  assert.match(failed.stderr, /No such file|cannot access/i);
});

test('process random returns a u32', async t => {
  const session = await app(t);
  const got = await session.command({ kind: 'random' });
  assert.equal(got.kind, 'random');
});

test('oversized native environment output returns a bounded error and preserves the session', async t => {
  const session = await app(t, { BENDFLOW_LARGE: '😀'.repeat(30), BENDFLOW_SMALL: 'ok' });
  assert.deepEqual(await session.command({ kind: 'env', name: 'BENDFLOW_LARGE' }), {
    kind: 'fail', code: 75, message: 'reply exceeds text bound',
  });
  assert.deepEqual(await session.command({ kind: 'env', name: 'BENDFLOW_SMALL' }), { kind: 'text', text: 'ok' });
});
