import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { hostname, release } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { z } from 'zod';
import { SESSION_KINDS } from '../../contracts/kinds.ts';
import { command, defaultOutput, sourceSha256 } from '../../scripts/build/cuda.ts';
import { fixture, gpuProfileSchema, loadBuild, unavailableReason } from '../../scripts/conformance/gpu.ts';
import { readHardware } from '../../scripts/conformance/hardware.ts';
import { environment, revision } from '../../scripts/lib/toolchain.ts';
import { createAppClient } from '../../src/client.ts';
import { runtimeArgs } from '../../src/runtime.ts';
import { bounded } from '../support/deadlines.ts';
import { gateway } from '../support/gateways.ts';
import { assertGone, scratch } from '../support/resources.ts';

function failureProfile() {
  return {
    schemaVersion: 1, profile: 'gpu', sourceSha256: sourceSha256(),
    host: { hostname: hostname(), platform: process.platform, release: release() },
    toolchain: { node: process.version, revision, clang: 'negative admission fixture', cudaHome: environment.CUDA_HOME ?? '', cudaVersion: '', bun: '', bend: '' },
    commands: [], fixture, setup: 'Negative HTTP admission fixture; no successful GPU execution claimed',
    environment: { CC: environment.CC, CUDA_HOME: environment.CUDA_HOME, LD_LIBRARY_PATH: environment.LD_LIBRARY_PATH, BENDRTS: '' },
    status: 'failed', detail: 'Requested GPU profile failed', instrumentation: null,
  };
}

async function refusesGpuThenRunsCpu(t: test.TestContext, gpuEvidence: string, status?: 'unavailable' | 'failed') {
  const spawn = t.mock.method(childProcess, 'spawn');
  syncBuiltinESMExports();
  t.after(() => { spawn.mock.restore(); syncBuiltinESMExports(); });
  const server = await gateway(t, { gpuEvidence, maxSessions: 1 });
  const remote = createAppClient(server.url);
  const response = await bounded(fetch(`${server.origin}/capabilities`));
  const listed = z.object({
    profiles: z.array(z.object({ profile: z.string(), status: z.string(), reason: z.string().optional() })),
    hardware: z.object({ status: z.string(), report: z.string() }).optional(),
  }).parse(await response.json());
  assert.equal(listed.profiles.find(row => row.profile === 'gpu')?.status, 'unavailable');
  if (status) assert.deepEqual(listed.hardware, { status, report: resolve(gpuEvidence) });
  else assert.equal(listed.hardware, undefined);
  for (let attempt = 0; attempt < 2; attempt++) {
    await assert.rejects(bounded(remote.sessions.create({ kind: 'compute', execution: { profile: 'gpu' } })), {
      code: 'SERVICE_UNAVAILABLE', message: 'GPU execution requires current verified hardware evidence',
    });
  }
  for (const kind of SESSION_KINDS.filter(kind => kind !== 'compute')) {
    const rejected = await bounded(fetch(`${server.url}/sessions/create`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ json: { kind, execution: { profile: 'gpu' } } }),
    }));
    assert.equal(rejected.status, 400, kind);
    await rejected.text();
  }
  assert.equal(spawn.mock.callCount(), 0, 'GPU refusal must precede process spawn');
  assert.deepEqual(server.workerPids, []);
  const cpu = await bounded(remote.sessions.create({ kind: 'compute' }), 10_000);
  assert.deepEqual(cpu.execution, { profile: 'native-cpu' });
  assert.deepEqual(await bounded(remote.compute.command({ sessionId: cpu.sessionId, command: { kind: 'sum', items: [3, 5, 8] } })), { kind: 'sum', value: 16 });
  assert.equal(spawn.mock.callCount(), 1, 'Failed GPU admissions must release session capacity');
  const pids = server.workerPids;
  await bounded(remote.sessions.close({ sessionId: cpu.sessionId }));
  pids.forEach(assertGone);
  assert.deepEqual(server.workerPids, []);
}

test('HTTP GPU admission defaults unavailable without spawning and later admits CPU', async t => {
  await refusesGpuThenRunsCpu(t, '');
});

test('HTTP GPU admission rejects an explicitly missing evidence path', async t => {
  const dir = await scratch(t, 'bendflow-gpu-missing-');
  await refusesGpuThenRunsCpu(t, join(dir, 'missing.json'), 'unavailable');
});

test('HTTP GPU admission rejects failed evidence without CPU fallback', async t => {
  const dir = await scratch(t, 'bendflow-gpu-failed-');
  const path = join(dir, 'profile.json');
  await writeFile(path, JSON.stringify(gpuProfileSchema.parse(failureProfile())));
  await refusesGpuThenRunsCpu(t, path, 'failed');
});

test('HTTP GPU admission rejects malformed configured evidence', async t => {
  const dir = await scratch(t, 'bendflow-gpu-invalid-');
  const path = join(dir, 'profile.json');
  await writeFile(path, '{');
  await refusesGpuThenRunsCpu(t, path, 'failed');
});

test('HTTP GPU admission rejects current unavailable evidence', async t => {
  const dir = await scratch(t, 'bendflow-gpu-unavailable-');
  const path = join(dir, 'profile.json');
  const profile = gpuProfileSchema.parse({ ...failureProfile(), status: 'unavailable', reason: 'cuda-driver-unavailable', detail: 'Negative admission fixture: no CUDA device' });
  await writeFile(path, JSON.stringify(profile));
  await refusesGpuThenRunsCpu(t, path, 'unavailable');
});

test('HTTP GPU admission rejects an actual local WSL managed-memory capability probe', async t => {
  const executable = resolve(defaultOutput, 'compute-worker-cuda');
  if (!/wsl/i.test(release()) || !existsSync(executable) || !existsSync(resolve(defaultOutput, 'build.json'))) {
    t.skip('Requires the local WSL CUDA-linked production worker; no GPU execution success is inferred');
    return;
  }
  const observed = command(executable, runtimeArgs('gpu'));
  assert.notEqual(observed.status, 0);
  assert.equal(unavailableReason(observed.stderr), 'concurrent-managed-access', JSON.stringify(observed));
  const dir = await scratch(t, 'bendflow-gpu-wsl-');
  const path = join(dir, 'profile.json');
  const profile = gpuProfileSchema.parse({
    ...failureProfile(), toolchain: loadBuild(defaultOutput).toolchain, commands: [observed],
    status: 'unavailable', reason: 'concurrent-managed-access', detail: JSON.stringify(observed),
    setup: 'Actual WSL capability rejection only; native Linux concurrent managed access is required for workload verification',
  });
  await writeFile(path, JSON.stringify(profile));
  assert.equal(readHardware(path).status, 'unavailable');
  await refusesGpuThenRunsCpu(t, path, 'unavailable');
});
