import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { checkCudaDependencies, checkCudaPackage, checkDeviceArtifact, gpuProfileSchema, profileExitCode, synchronizedKernels, unavailableReason } from '../../scripts/conformance/gpu.ts';
import { defaultOutput, instrumentCuda, sourceSha256 } from '../../scripts/build/cuda.ts';
import { hostname, release } from 'node:os';
import { readHardware } from '../../scripts/conformance/hardware.ts';
import { evaluateCompletion, parseCompletionArgs } from '../../scripts/conformance/completion.ts';
import { inventorySchema } from '../../scripts/conformance/inventory.ts';

function temporary(t: test.TestContext): string {
  mkdirSync(defaultOutput, { recursive: true });
  const path = mkdtempSync(resolve(defaultOutput, 'unit-'));
  t.after(() => rmSync(path, { recursive: true, force: true }));
  return path;
}

test('CUDA artifact requires a matching runtime key, managed memory, and cubin payload', t => {
  const path = resolve(temporary(t), 'compute.gpu');
  const diagnostics = 'BENDFLOW_CUDA_DEVICE managed=1 key=0123456789abcdef driver=13010 device=test device\n';
  assert.throws(() => checkDeviceArtifact(path, diagnostics), /without a .gpu artifact/);
  const container = Buffer.alloc(24);
  container.writeBigUInt64LE(0x0123456789abcdefn);
  container.set([0x7f, 0x45, 0x4c, 0x46], 8);
  writeFileSync(path, container);
  assert.equal(checkDeviceArtifact(path, diagnostics), '0123456789abcdef');
  assert.throws(() => checkDeviceArtifact(path, diagnostics.replace('managed=1', 'managed=0')), /capability/);
  assert.throws(() => checkDeviceArtifact(path, diagnostics.replace('0123456789abcdef', '0123456789abcdee')), /does not match/);
  container[8] = 0;
  writeFileSync(path, container);
  assert.throws(() => checkDeviceArtifact(path, diagnostics), /ELF cubin/);
  writeFileSync(path, container.subarray(0, 8));
  assert.throws(() => checkDeviceArtifact(path, diagnostics), /Truncated/);
});

test('CUDA evidence uses the latest completed cumulative counter and rejects incomplete diagnostics', () => {
  assert.equal(synchronizedKernels('BENDFLOW_CUDA_SYNCHRONIZED kernels=5\nBENDFLOW_CUDA_SYNCHRONIZED kernels=15\n'), 15);
  assert.equal(synchronizedKernels('BENDFLOW_CUDA_SYNCHRONIZED kernels=5'), 0);
  assert.equal(synchronizedKernels('CPU result kernels=100\n'), 0);
  assert.throws(() => synchronizedKernels('BENDFLOW_CUDA_SYNCHRONIZED kernels=15\nBENDFLOW_CUDA_SYNCHRONIZED kernels=5\n'), /backwards/);
  assert.throws(() => synchronizedKernels('BENDFLOW_CUDA_SYNCHRONIZED kernels=99999999999999999999\n'), /Invalid/);
});

test('CUDA launch and synchronization instrumentation rejects changed compiler hooks', () => {
  assert.throws(() => instrumentCuda('int main(void) { return 0; }'), /synchronization hook changed/);
});

test('CUDA dependencies remain required with GPU disabled', () => {
  const observation = { program: 'ldd', args: [], cwd: '/', status: 0, signal: null, stdout: 'libcuda.so.1 => /driver\nlibnvrtc.so.13 => /nvrtc\n', stderr: '', error: null };
  checkCudaDependencies(observation);
  assert.throws(() => checkCudaDependencies({ ...observation, stdout: 'libcuda.so.1 => not found\nlibnvrtc.so.13 => /nvrtc\n' }), /not found/);
  assert.throws(() => checkCudaDependencies({ ...observation, stdout: 'libc.so.6 => /libc\n' }));
  assert.throws(() => checkCudaDependencies({ ...observation, status: 1 }));
});

test('Only missing hardware prerequisites produce unavailable, not launch or compilation failures', () => {
  assert.equal(unavailableReason('CUDA device lacks concurrent managed access (WSL2 lacks it)'), 'concurrent-managed-access');
  assert.equal(unavailableReason('cuDeviceGet failed: CUDA_ERROR_NO_DEVICE'), 'cuda-driver-unavailable');
  assert.equal(unavailableReason('cuInit failed: CUDA_ERROR_INSUFFICIENT_DRIVER'), 'cuda-driver-unavailable');
  for (const detail of ['device launch failed', 'device fault', 'cannot compile the CUDA library', 'cuInit failed: CUDA_ERROR_UNKNOWN', '--gpu-build succeeded without a .gpu artifact']) assert.equal(unavailableReason(detail), undefined);
  assert.equal(profileExitCode({ status: 'failed' }, false), 1);
  assert.equal(profileExitCode({ status: 'failed' }, true), 1);
  assert.equal(profileExitCode({ status: 'unavailable' }, false), 0);
  assert.equal(profileExitCode({ status: 'unavailable' }, true), 1);
  assert.equal(profileExitCode({ status: 'verified' }, true), 0);
});

test('CPU fallback results cannot be parsed as GPU verification', t => {
  // Controlled schema fixtures are not observed production GPU results.
  const base = { schemaVersion: 1, profile: 'gpu', sourceSha256: 'c'.repeat(64), host: { hostname: 'unit-host', platform: 'linux', release: 'unit-kernel' },
    toolchain: { node: 'v24', revision: 'a'.repeat(40), clang: '19', cudaHome: '/cuda', cudaVersion: '13.1', bun: '1.3.3', bend: '2.0.40' }, commands: [],
    fixture: { sumItems: [1, 2], renderDepth: 4, sampleCount: 512, phase: 7 }, setup: 'Native Linux runner',
    environment: { CC: 'clang-19', LD_LIBRARY_PATH: '/cuda/lib', BENDRTS: '' } };
  assert.equal(gpuProfileSchema.safeParse({ ...base, status: 'unavailable', reason: 'concurrent-managed-access', detail: 'managed=0', instrumentation: null }).success, true);
  assert.equal(gpuProfileSchema.safeParse({ ...base, profile: 'cpu-fallback', status: 'verified', gpuExecutionVerified: false }).success, false);
  assert.equal(gpuProfileSchema.safeParse({ ...base, status: 'passed' }).success, false);
  const artifact = { executable: '/compute', executableSha256: 'a'.repeat(64), path: '/compute.gpu', sha256: 'b'.repeat(64), runtimeKey: 'a'.repeat(16) };
  assert.equal(gpuProfileSchema.safeParse({ ...base, status: 'verified', artifact, instrumentation: null }).success, false);
  const duplicateEvidence = Array.from({ length: 4 }, () => ({ workload: 'sum', synchronizedKernels: 5 }));
  assert.equal(gpuProfileSchema.safeParse({ ...base, status: 'verified', artifact, instrumentation: { kind: 'runtime-cuda-synchronization', evidence: duplicateEvidence } }).success, false);
  const path = resolve(temporary(t), 'profile.json');
  const candidate = gpuProfileSchema.parse({ ...base, status: 'verified', artifact, instrumentation: { kind: 'runtime-cuda-synchronization', evidence: ['sum', 'sort', 'render', 'samples'].map(workload => ({ workload, synchronizedKernels: 5 })) } });
  writeFileSync(path, JSON.stringify(candidate));
  const rejected = readHardware(path);
  assert.equal(rejected.status, 'failed');
  if (rejected.status === 'failed') assert.match(rejected.detail, /source is stale/);
  const currentCandidate = { ...candidate, sourceSha256: sourceSha256(), host: { hostname: hostname(), platform: process.platform, release: release() } };
  writeFileSync(path, JSON.stringify(currentCandidate));
  assert.equal(readHardware(path).status, 'failed', 'Verified schema without a matching build must fail');
  writeFileSync(resolve(path, '..', 'build.json'), JSON.stringify({ schemaVersion: 1, cpu: '/unit-cpu', cuda: '/compute', sourceRoot: resolve(defaultOutput, '../..'), sourceSha256: sourceSha256(), toolchain: base.toolchain,
    artifacts: ['/unit-cpu', '/compute', '/unit-cpu.c', '/compute.c'].map(path => ({ path, sha256: 'a'.repeat(64) })), commands: [] }));
  const changedToolchain = readHardware(path);
  assert.equal(changedToolchain.status, 'failed');
  if (changedToolchain.status === 'failed') assert.match(changedToolchain.detail, /Node version changed/);
  // Completion uses standalone evidence independently and never edits inventory.
  const inventory = inventorySchema.parse({ version: 1, features: [{ id: 'hardware.gpu', target: 'compute', commands: ['sum'], profile: 'gpu', status: 'unavailable', reason: 'unit fixture', prerequisites: ['GPU'] }], profiles: [{ profile: 'gpu', status: 'unavailable', reason: 'unit fixture', prerequisites: ['GPU'] }] });
  assert.equal(evaluateCompletion(inventory, [], 'portable', rejected).completion, 'portable-complete');
  assert.equal(evaluateCompletion(inventory, [], 'full', rejected).completion, 'in-progress');
  const completed = evaluateCompletion(inventory, [], 'full', { status: 'verified', report: 'unit-only', evidence: candidate.status === 'verified' ? candidate : assert.fail() });
  assert.equal(completed.completion, 'full-complete');
  assert.equal(completed.features[0]?.status, 'unavailable');
  assert.equal(completed.profiles[0]?.status, 'unavailable');
  assert.equal(evaluateCompletion(inventory, [{ file: 'tests/unit/unit.test.ts', name: 'failed reference', status: 'failed' }], 'full', { status: 'verified', report: 'unit-only', evidence: candidate.status === 'verified' ? candidate : assert.fail() }).completion, 'in-progress');
  assert.deepEqual(parseCompletionArgs(['--mode', 'full', '--hardware-report', 'profile.json', '--report', 'results.json']), { mode: 'full', report: 'results.json', hardwareReport: 'profile.json' });
  assert.throws(() => parseCompletionArgs(['--mode', 'full', '--report', 'a', '--report', 'b']));
});

test('Requested GPU CLI failure emits failed JSON and exits nonzero', t => {
  const output = temporary(t);
  const cli = fileURLToPath(new URL('../../scripts/conformance/gpu.ts', import.meta.url));
  const child = spawnSync(process.execPath, [cli, 'required', output], { encoding: 'utf8', timeout: 30_000 });
  assert.equal(child.status, 1, child.stderr);
  const result = gpuProfileSchema.parse(JSON.parse(child.stdout));
  assert.equal(result.status, 'failed');
  assert.deepEqual(gpuProfileSchema.parse(JSON.parse(readFileSync(resolve(output, 'profile.json'), 'utf8'))), result);
});

test('Packaging refuses missing evidence rather than claiming the host binary is a CUDA package', t => {
  const output = temporary(t);
  const result = checkCudaPackage({ output });
  assert.equal(result.status, 'failed');
  assert.ok(existsSync(resolve(output, 'packaging.json')));
});
