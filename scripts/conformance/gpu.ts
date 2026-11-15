import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname, release } from 'node:os';
import { dirname, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { environment, revision } from '../lib/toolchain.ts';
import { PROJECT_ROOT } from '../../src/paths.ts';
import { NativeApp } from '../../src/app.ts';
import { availablePort } from '../../src/worker.ts';
import { runtimeArgs } from '../../src/runtime.ts';
import { computeCodec } from '../../src/protocol/apps.ts';
import { type ComputeCommand } from '../../contracts/compute.ts';
import { checkCurrentToolchain, command, defaultOutput, sha256, sourceSha256 } from '../build/cuda.ts';

const observation = z.strictObject({ program: z.string().min(1), args: z.array(z.string()), cwd: z.string(), status: z.number().int().nullable(), signal: z.string().nullable(), stdout: z.string(), stderr: z.string(), error: z.string().nullable() });
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const evidence = z.strictObject({ workload: z.enum(['sum', 'sort', 'render', 'samples']), synchronizedKernels: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) });
const common = {
  schemaVersion: z.literal(1), profile: z.literal('gpu'), sourceSha256: hash,
  host: z.strictObject({ hostname: z.string().min(1), platform: z.string().min(1), release: z.string().min(1) }),
  toolchain: z.strictObject({ node: z.string(), revision: hash.or(z.string().regex(/^[a-f0-9]{40}$/)), clang: z.string(), cudaHome: z.string(), cudaVersion: z.string(), bun: z.string(), bend: z.string() }),
  commands: z.array(observation), fixture: z.strictObject({ sumItems: z.array(z.number().int()), renderDepth: z.literal(4), sampleCount: z.literal(512), phase: z.literal(7) }),
  setup: z.string(), environment: z.strictObject({ CC: z.string(), CUDA_HOME: z.string().optional(), LD_LIBRARY_PATH: z.string(), BENDRTS: z.literal('') }),
};
export const gpuProfileSchema = z.discriminatedUnion('status', [
  z.strictObject({ ...common, status: z.literal('verified'), artifact: z.strictObject({ executable: z.string(), executableSha256: hash, path: z.string(), sha256: hash, runtimeKey: z.string().regex(/^[a-f0-9]{16}$/) }), instrumentation: z.strictObject({ kind: z.literal('runtime-cuda-synchronization'), evidence: z.array(evidence).length(4) }).refine(i => new Set(i.evidence.map(e => e.workload)).size === 4) }),
  z.strictObject({ ...common, status: z.literal('unavailable'), reason: z.enum(['concurrent-managed-access', 'cuda-driver-unavailable']), detail: z.string().min(1), instrumentation: z.literal(null) }),
  z.strictObject({ ...common, status: z.literal('failed'), detail: z.string().min(1), instrumentation: z.literal(null) }),
]);
export type GpuProfileResult = z.infer<typeof gpuProfileSchema>;

export function unavailableReason(detail: string): 'concurrent-managed-access' | 'cuda-driver-unavailable' | undefined {
  if (detail.includes('CUDA device lacks concurrent managed access')) return 'concurrent-managed-access';
  if (/(cuInit|cuDeviceGet) failed: CUDA_ERROR_(NO_DEVICE|INSUFFICIENT_DRIVER|SYSTEM_DRIVER_MISMATCH)/.test(detail)) return 'cuda-driver-unavailable';
  return undefined;
}

export function synchronizedKernels(diagnostics: string): number {
  const counts = [...diagnostics.matchAll(/^BENDFLOW_CUDA_SYNCHRONIZED kernels=(\d+)\n/gm)].map(match => Number(match[1]));
  assert.ok(counts.every(n => Number.isSafeInteger(n) && n >= 0), 'Invalid CUDA kernel counter');
  assert.ok(counts.every((n, i) => i === 0 || n >= (counts[i - 1] ?? 0)), 'CUDA kernel counter moved backwards');
  return counts.at(-1) ?? 0;
}

export function checkDeviceArtifact(path: string, diagnostics: string): string {
  const key = /BENDFLOW_CUDA_DEVICE managed=1 key=([a-f0-9]{16}) driver=\d+ device=.+/.exec(diagnostics)?.[1];
  assert.ok(key, 'No runtime managed-memory capability and artifact-key evidence');
  assert.ok(existsSync(path), '--gpu-build succeeded without a .gpu artifact');
  const bytes = readFileSync(path);
  assert.ok(bytes.length > 12, 'Truncated CUDA artifact');
  assert.equal(bytes.readBigUInt64LE().toString(16).padStart(16, '0'), key, 'CUDA artifact does not match executable/runtime key');
  assert.deepEqual(bytes.subarray(8, 12), Buffer.from([0x7f, 0x45, 0x4c, 0x46]), 'CUDA artifact payload is not an ELF cubin');
  return key;
}

export function profileExitCode(result: { status: 'verified' | 'unavailable' | 'failed' }, requested: boolean): number {
  return result.status === 'failed' || (requested && result.status !== 'verified') ? 1 : 0;
}

export const fixture = { sumItems: Array.from({ length: 32 }, (_, i) => (i * 0x1234567) >>> 0), renderDepth: 4, sampleCount: 512, phase: 7 } satisfies z.infer<typeof gpuProfileSchema>['fixture'];

function pixels(depth: number, tick: number, position: number, x = 0, y = 0, side = 2 ** depth): number[] {
  if (depth === 0) return [(((x + position) % 256) * 2 ** 24 + ((y + tick) % 256) * 2 ** 16 + ((x + 17 * y + 31 * tick) % 256) * 256 + 255) >>> 0];
  const h = side / 2;
  return [...pixels(depth - 1, tick, position, x, y, h), ...pixels(depth - 1, tick, position, x + h, y, h), ...pixels(depth - 1, tick, position, x, y + h, h), ...pixels(depth - 1, tick, position, x + h, y + h, h)];
}

export async function verifyCompute(options: { executable: string; gpu: boolean; commands: z.infer<typeof observation>[] }) {
  const port = await availablePort();
  const profile = options.gpu ? 'gpu' : 'native-cpu';
  const observedCommand: z.infer<typeof observation> = { program: options.executable, args: [...runtimeArgs(profile), String(port)], cwd: process.cwd(), status: null, signal: null, stdout: '', stderr: '', error: null };
  options.commands.push(observedCommand);
  const app = await NativeApp.start(computeCodec, { executable: options.executable, port, profile, env: environment, callMs: 30_000 }).catch(error => {
    observedCommand.error = String(error);
    throw error;
  });
  const observations: z.infer<typeof evidence>[] = [];
  async function workload(name: z.infer<typeof evidence>['workload'], request: ComputeCommand) {
    const before = synchronizedKernels(app.diagnostics);
    const reply = await app.command(request);
    // stderr and TCP replies travel independently; reject an earlier workload's counter.
    for (let i = 0; options.gpu && synchronizedKernels(app.diagnostics) <= before && i < 50; i++) await delay(10);
    const kernels = synchronizedKernels(app.diagnostics) - before;
    if (options.gpu) {
      assert.ok(kernels > 0, `${name}: no synchronized CUDA kernel evidence`);
      observations.push({ workload: name, synchronizedKernels: kernels });
    } else assert.equal(kernels, 0, 'CPU fallback executed CUDA work');
    return reply;
  }
  async function captured(name: 'render' | 'samples', request: ComputeCommand, expected: number[]) {
    const reply = await workload(name, request);
    assert.equal(reply.kind, 'snapshot');
    if (reply.kind !== 'snapshot') throw new Error('Expected snapshot');
    assert.equal(reply.total, expected.length);
    const actual: number[] = [];
    while (actual.length < expected.length) {
      const page = await app.command({ kind: 'page', snapshot: reply.snapshot, offset: actual.length, max: 32 });
      if (page.kind !== 'page') throw new Error('Expected page');
      assert.equal(page.snapshot, reply.snapshot); assert.equal(page.count, page.data.length);
      assert.equal(page.offset, actual.length); assert.equal(page.total, expected.length);
      assert.ok(page.data.length > 0); actual.push(...page.data);
      assert.equal(page.done, actual.length === expected.length);
    }
    assert.deepEqual(actual, expected);
    assert.deepEqual(await app.command({ kind: 'release', snapshot: reply.snapshot }), { kind: 'ok' });
  }
  try {
    if (options.gpu) {
      for (let i = 0; !app.diagnostics.includes('BENDFLOW_CUDA_DEVICE managed=1 key=') && i < 50; i++) await delay(10);
      checkDeviceArtifact(`${options.executable}.gpu`, app.diagnostics);
    }
    assert.deepEqual(await app.command({ kind: 'threads' }), { kind: 'threads', value: 1 });
    assert.deepEqual(await workload('sum', { kind: 'sum', items: fixture.sumItems }), { kind: 'sum', value: Number(fixture.sumItems.reduce((a, b) => a + BigInt(b), 0n) & 0xffffffffn) });
    assert.deepEqual(await workload('sort', { kind: 'sort', items: fixture.sumItems }), { kind: 'sorted', items: [...fixture.sumItems].sort((a, b) => a - b) });
    await app.command({ kind: 'advance', steps: fixture.phase });
    await captured('render', { kind: 'render', depth: fixture.renderDepth }, pixels(4, 7, 7));
    const bytes = Buffer.alloc(4);
    const samples = Array.from({ length: 512 }, (_, i) => { bytes.writeFloatLE(((i + 7) % 32) / 16 - 1); return bytes.readUInt32LE(); });
    await captured('samples', { kind: 'samples', count: 512 }, samples);
    assert.doesNotMatch(app.diagnostics, /missing or stale/);
    return observations;
  } catch (error) {
    observedCommand.error = String(error);
    throw error;
  } finally {
    try { await app.close(); } catch (error) { observedCommand.error = String(error); throw error; }
    finally { observedCommand.stderr = app.diagnostics; }
  }
}

export async function runGpuProfile(options: { output?: string } = {}): Promise<GpuProfileResult> {
  const output = resolve(options.output ?? defaultOutput);
  const commands: z.infer<typeof observation>[] = [];
  const base = { schemaVersion: 1, profile: 'gpu', sourceSha256: sourceSha256(), host: { hostname: hostname(), platform: process.platform, release: release() },
    toolchain: { node: process.version, revision, clang: 'not recorded', cudaHome: environment.CUDA_HOME ?? 'not configured', cudaVersion: 'not recorded', bun: 'not recorded', bend: 'not recorded' }, commands, fixture,
    environment: { CC: environment.CC, CUDA_HOME: environment.CUDA_HOME, LD_LIBRARY_PATH: environment.LD_LIBRARY_PATH, BENDRTS: '' },
    setup: 'Use native Linux with an NVIDIA device supporting concurrent managed access, Clang 19 and the local CUDA toolkit. Run node scripts/build/cuda.ts, then node scripts/conformance/gpu.ts required.' };
  let result: GpuProfileResult;
  try {
    const manifest = loadBuild(output);
    base.toolchain = manifest.toolchain;
    commands.push(...manifest.commands);
    checkBuildHashes(manifest);
    const gpu = `${manifest.cuda}.gpu`;
    const generated = command(manifest.cuda, ['+RTS', '--gpu-build', '-RTS']); commands.push(generated);
    // --gpu-build precedes capability enforcement. Missing-port startup checks it.
    const probe = command(manifest.cuda, ['+RTS', '--threads', '1', '--gpu', 'on', '-RTS']); commands.push(probe);
    const detail = JSON.stringify(probe);
    const reason = unavailableReason(detail);
    if (reason && probe.status !== 0) {
      result = gpuProfileSchema.parse({ ...base, status: 'unavailable', reason, detail: `${detail}; device artifact exists=${existsSync(gpu)}; --gpu-build exit zero alone is not artifact evidence`, instrumentation: null });
    } else {
      assert.equal(generated.status, 0, JSON.stringify(generated));
      assert.equal(probe.status, 1, detail);
      assert.match(probe.stderr, /usage: compute-gpu-worker PORT/, 'Capability probe did not reach the application usage check');
      const runtimeKey = checkDeviceArtifact(gpu, probe.stderr);
      const deviceHash = sha256(gpu);
      const dependencies = command('ldd', [manifest.cuda]); commands.push(dependencies);
      checkCudaDependencies(dependencies);
      const observed = await verifyCompute({ executable: manifest.cuda, gpu: true, commands });
      assert.equal(sha256(gpu), deviceHash, 'Device artifact changed during verification');
      checkBuildHashes(manifest);
      result = gpuProfileSchema.parse({ ...base, status: 'verified', artifact: { executable: manifest.cuda, executableSha256: sha256(manifest.cuda), path: gpu, sha256: deviceHash, runtimeKey }, instrumentation: { kind: 'runtime-cuda-synchronization', evidence: observed } });
    }
  } catch (error) {
    result = gpuProfileSchema.parse({ ...base, status: 'failed', detail: String(error), instrumentation: null });
  }
  mkdirSync(dirname(resolve(output, 'profile.json')), { recursive: true });
  writeFileSync(resolve(output, 'profile.json'), JSON.stringify(result, null, 2) + '\n');
  return result;
}

export function loadBuild(output: string) {
  return z.object({ schemaVersion: z.literal(1), cpu: z.string(), cuda: z.string(), sourceRoot: z.string(), sourceSha256: hash, toolchain: common.toolchain,
    artifacts: z.array(z.strictObject({ path: z.string(), sha256: hash })).length(4), commands: z.array(observation) })
    .parse(JSON.parse(readFileSync(resolve(output, 'build.json'), 'utf8')));
}

export function checkBuildHashes(manifest: ReturnType<typeof loadBuild>): void {
  assert.equal(resolve(manifest.sourceRoot), resolve(PROJECT_ROOT), 'Build belongs to another source checkout');
  assert.equal(manifest.sourceSha256, sourceSha256(), 'Production source changed since CUDA build');
  checkCurrentToolchain(manifest.toolchain);
  for (const file of [manifest.cpu, manifest.cuda, `${manifest.cpu}.c`, `${manifest.cuda}.c`]) {
    const artifact = manifest.artifacts.find(a => a.path === file);
    assert.ok(artifact, `Missing build hash: ${file}`);
    assert.equal(sha256(file), artifact.sha256, `Build artifact changed: ${file}`);
  }
}

export function checkCudaDependencies(dependencies: ReturnType<typeof command>): void {
  assert.equal(dependencies.status, 0, JSON.stringify(dependencies));
  assert.match(dependencies.stdout, /libcuda\.so\.1/);
  assert.match(dependencies.stdout, /libnvrtc\.so\.(12|13)/);
  assert.doesNotMatch(dependencies.stdout, /not found/);
}

export async function runCpuFallback(options: { output?: string } = {}) {
  const output = resolve(options.output ?? defaultOutput);
  const commands: z.infer<typeof observation>[] = [];
  const base = { schemaVersion: 1, profile: 'cpu-fallback', host: { hostname: hostname(), platform: process.platform, release: release() },
    environment: { CC: environment.CC, CUDA_HOME: environment.CUDA_HOME, LD_LIBRARY_PATH: environment.LD_LIBRARY_PATH, BENDRTS: '' }, commands, fixture };
  let result;
  try {
    const manifest = loadBuild(output);
    checkBuildHashes(manifest);
    const cpuDependencies = command('ldd', [manifest.cpu]); commands.push(cpuDependencies);
    assert.equal(cpuDependencies.status, 0);
    assert.doesNotMatch(cpuDependencies.stdout, /libcuda|libnvrtc|not found/);
    const cudaDependencies = command('ldd', [manifest.cuda]); commands.push(cudaDependencies);
    checkCudaDependencies(cudaDependencies);
    for (const executable of [manifest.cpu, manifest.cuda]) await verifyCompute({ executable, gpu: false, commands });
    checkBuildHashes(manifest);
    result = { ...base, status: 'verified', sourceSha256: manifest.sourceSha256, toolchain: manifest.toolchain, gpuExecutionVerified: false };
  } catch (error) { result = { ...base, status: 'failed', detail: String(error), gpuExecutionVerified: false }; }
  mkdirSync(output, { recursive: true });
  writeFileSync(resolve(output, 'fallback.json'), JSON.stringify(result, null, 2) + '\n');
  return result;
}

export function checkVerifiedProfile(profile: Extract<GpuProfileResult, { status: 'verified' }>, output: string) {
  const manifest = loadBuild(output);
  checkBuildHashes(manifest);
  assert.equal(profile.sourceSha256, manifest.sourceSha256, 'Profile source hash does not match build');
  assert.deepEqual(profile.toolchain, manifest.toolchain, 'Profile toolchain does not match build');
  assert.equal(profile.host.hostname, hostname(), 'Profile belongs to another host');
  assert.equal(profile.host.platform, process.platform);
  assert.equal(profile.host.release, release(), 'Host kernel changed');
  assert.deepEqual(profile.fixture, fixture, 'Profile does not describe the production fixtures');
  assert.equal(profile.artifact.executable, manifest.cuda);
  assert.equal(profile.artifact.path, `${manifest.cuda}.gpu`);
  assert.equal(sha256(manifest.cuda), profile.artifact.executableSha256);
  assert.equal(sha256(profile.artifact.path), profile.artifact.sha256);
  const execution = profile.commands.find(c => c.program === manifest.cuda && c.status === null && c.error === null && c.args.includes('--gpu') && c.args[c.args.indexOf('--gpu') + 1] === 'on' && c.args.at(-1) !== '-RTS');
  assert.ok(execution, 'No successful GPU workload command observation');
  assert.equal(checkDeviceArtifact(profile.artifact.path, execution.stderr), profile.artifact.runtimeKey);
  const total = profile.instrumentation.evidence.reduce((sum, row) => sum + row.synchronizedKernels, 0);
  assert.ok(Number.isSafeInteger(total) && synchronizedKernels(execution.stderr) >= total, 'Kernel evidence exceeds observed synchronized execution');
  assert.doesNotMatch(execution.stderr, /missing or stale|device fault|device launch failed/);
  checkCudaDependencies(command('ldd', [manifest.cuda]));
  return manifest;
}

export function checkCudaPackage(options: { output?: string } = {}) {
  const output = resolve(options.output ?? defaultOutput);
  const commands: z.infer<typeof observation>[] = [];
  let result;
  try {
    const profile = gpuProfileSchema.parse(JSON.parse(readFileSync(resolve(output, 'profile.json'), 'utf8')));
    assert.equal(profile.status, 'verified', 'CUDA package requires a verified GPU profile');
    if (profile.status !== 'verified') throw new Error('GPU profile is not verified');
    const manifest = checkVerifiedProfile(profile, output);
    const dependencies = command('ldd', [manifest.cuda]); commands.push(dependencies);
    checkCudaDependencies(dependencies);
    result = { status: 'verified', artifact: profile.artifact, runtimeLibraries: dependencies.stdout, commands };
  } catch (error) { result = { status: 'failed', detail: String(error), commands }; }
  mkdirSync(output, { recursive: true });
  writeFileSync(resolve(output, 'packaging.json'), JSON.stringify(result, null, 2) + '\n');
  return result;
}

if (import.meta.main) {
  const [mode, output, ...extra] = process.argv.slice(2);
  assert.ok((mode === 'probe' || mode === 'required' || mode === 'fallback' || mode === 'package') && extra.length === 0, 'Usage: node scripts/conformance/gpu.ts probe|required|fallback|package [OUTPUT_DIRECTORY]');
  if (mode === 'fallback' || mode === 'package') {
    const result = mode === 'fallback' ? await runCpuFallback({ output }) : checkCudaPackage({ output });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    process.exitCode = result.status === 'failed' ? 1 : 0;
  } else {
    const result = await runGpuProfile({ output });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    process.exitCode = profileExitCode(result, mode === 'required');
  }
}
