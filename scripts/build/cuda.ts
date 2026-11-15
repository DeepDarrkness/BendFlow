import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROJECT_ROOT } from '../../src/paths.ts';
import { bun, environment, revision, source } from '../lib/toolchain.ts';

export const defaultOutput = fileURLToPath(new URL('../../build/cuda/', import.meta.url));
export const deviceMarker = 'BENDFLOW_CUDA_DEVICE managed=1 key=';
export const synchronizedBatch = 'BENDFLOW_CUDA_SYNCHRONIZED kernels=';
const synchronization = 'if (cuCtxSynchronize() != CUDA_SUCCESS) {\n      err_fail("device fault");\n    }';
const deviceReady = '    why = "cuCtxSetCurrent";\n    goto fail;\n  }\n  return NULL;';
const cudaStart = '#elif BEND_CUDA\n\nstatic u64 gpu_hash(void) {';
const cubeEnd = '  a32_store(a32_at(H, H_CURSOR), 0);\n}';

export function instrumentCuda(c: string): string {
  assert.equal(c.split(synchronization).length, 2, 'Pinned CUDA synchronization hook changed');
  assert.equal(c.split(deviceReady).length, 2, 'Pinned CUDA capability hook changed');
  assert.equal(c.split(cudaStart).length, 2, 'Pinned CUDA section changed');
  assert.equal(c.split(cubeEnd).length, 2, 'Pinned evaluation completion changed');
  assert.ok(c.includes('for (u32 i = 0; i < 5; i += 1)') && c.includes('if (cuLaunchKernel(gpu_pso,'), 'Pinned five-launch CUDA batch changed');
  return c.replace(cudaStart, cudaStart.replace('static u64 gpu_hash', 'static unsigned long long completed = 0;\n\nstatic u64 gpu_hash'))
    .replace(synchronization, `${synchronization}\n    completed += (unsigned long long)n * 5;`)
    .replace(cubeEnd, cubeEnd.replace('\n}', `\n#if BEND_CUDA\n  if (gpu) {\n    fprintf(stderr, "${synchronizedBatch}%llu\\n", completed);\n    fflush(stderr);\n  }\n#endif\n}`))
    .replace(deviceReady, deviceReady.replace('  return NULL;', `  char device_name[256] = {0};\n  int driver_version = 0;\n  cuDeviceGetName(device_name, sizeof device_name, gpu_dev);\n  cuDriverGetVersion(&driver_version);\n  fprintf(stderr, "${deviceMarker}%016llx driver=%d device=%s\\n",\n    (unsigned long long)gpu_hash(), driver_version, device_name);\n  fflush(stderr);\n  return NULL;`));
}

export function sha256(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

// Include transitive Bend modules and the production harness, not just entry points.
export function sourceSha256(root = PROJECT_ROOT): string {
  const hash = createHash('sha256');
  for (const directory of ['bend', 'contracts', 'src', 'scripts']) {
    const files = readdirSync(resolve(root, directory), { recursive: true, withFileTypes: true })
      .filter(entry => entry.isFile() && /\.(bend|ts)$/.test(entry.name))
      .map(entry => resolve(entry.parentPath, entry.name)).sort();
    for (const file of files) hash.update(relative(root, file)).update('\0').update(readFileSync(file)).update('\0');
  }
  return hash.digest('hex');
}

export function command(program: string, args: string[], cwd = PROJECT_ROOT) {
  const result = spawnSync(program, args, { cwd, env: { ...environment, BENDRTS: '' }, encoding: 'utf8', timeout: 120_000, maxBuffer: 8 * 1024 * 1024 });
  return { program, args, cwd, status: result.status, signal: result.signal, stdout: result.stdout ?? '', stderr: result.stderr ?? '', error: result.error?.message ?? null };
}

export function requiredCommand(program: string, args: string[], cwd = PROJECT_ROOT) {
  const result = command(program, args, cwd);
  assert.equal(result.status, 0, JSON.stringify(result));
  return result;
}

export function checkCurrentToolchain(toolchain: { node: string; revision: string; clang: string; cudaHome: string; cudaVersion: string; bun: string; bend: string }) {
  assert.equal(toolchain.node, process.version, 'Node version changed');
  assert.equal(toolchain.revision, revision, 'Pinned compiler revision changed');
  assert.equal(requiredCommand('git', ['rev-parse', 'HEAD'], source).stdout.trim(), revision);
  assert.equal(requiredCommand('git', ['status', '--porcelain', '--untracked-files=all'], source).stdout.trim(), '');
  assert.equal(toolchain.cudaHome, environment.CUDA_HOME, 'CUDA toolkit changed');
  assert.equal(toolchain.cudaVersion, requiredCommand(resolve(toolchain.cudaHome, 'bin/nvcc'), ['--version']).stdout.trim(), 'CUDA version changed');
  const cc = process.env.CUDA_CC ?? resolve(PROJECT_ROOT, '.toolchain/clang/usr/bin/clang-19');
  assert.equal(toolchain.clang, requiredCommand(cc, ['--version']).stdout.trim(), 'Clang version changed');
  assert.equal(toolchain.bun, requiredCommand(bun, ['--version']).stdout.trim(), 'Bun version changed');
  assert.equal(toolchain.bend, requiredCommand(bun, [resolve(source, 'bend2/main.ts'), 'version']).stdout.trim(), 'Bend version changed');
}

export function buildCuda(options: { sourceRoot?: string; output?: string } = {}) {
  assert.equal(process.platform, 'linux', 'CUDA profile requires Linux');
  assert.equal(process.arch, 'x64', 'Local CUDA profile requires x64');
  assert.equal(process.versions.node.split('.')[0], '24', 'Node 24 LTS is required');
  const root = resolve(options.sourceRoot ?? PROJECT_ROOT);
  const output = resolve(options.output ?? defaultOutput);
  const cc = process.env.CUDA_CC ?? resolve(PROJECT_ROOT, '.toolchain/clang/usr/bin/clang-19');
  const toolkit = environment.CUDA_HOME;
  assert.ok(toolkit && existsSync(resolve(toolkit, 'include/nvrtc.h')), 'CUDA toolkit required; run node scripts/setup/cuda.ts');
  const compilerRevision = requiredCommand('git', ['rev-parse', 'HEAD'], source);
  const compilerStatus = requiredCommand('git', ['status', '--porcelain', '--untracked-files=all'], source);
  assert.equal(compilerRevision.stdout.trim(), revision);
  assert.equal(compilerStatus.stdout.trim(), '');
  const compiler = requiredCommand(cc, ['--version']);
  assert.match(compiler.stdout, /clang version (19|[2-9][0-9])\./);
  const sourceHash = sourceSha256(root);
  mkdirSync(output, { recursive: true });
  const cpu = resolve(output, 'compute-worker-cpu');
  const cuda = resolve(output, 'compute-worker-cuda');
  const cpuC = `${cpu}.c`;
  const cudaC = `${cuda}.c`;
  const commands = [compilerRevision, compilerStatus, compiler,
    requiredCommand(bun, [resolve(source, 'bend2/main.ts'), resolve(root, 'bend/compute-worker.bend'), '-o', cpuC], root),
    requiredCommand(bun, [resolve(source, 'bend2/main.ts'), resolve(root, 'bend/compute-gpu-worker.bend'), '-o', cudaC], root)];
  assert.match(readFileSync(cpuC, 'utf8'), /^#define BANGS\s+0$/m);
  assert.doesNotMatch(readFileSync(cudaC, 'utf8'), /^#define BANGS\s+0$/m);
  writeFileSync(cudaC, instrumentCuda(readFileSync(cudaC, 'utf8')));
  const flags = ['-std=c11', '-O3', '-lpthread', '-lm'];
  commands.push(requiredCommand(cc, [cpuC, ...flags, '-o', cpu]));
  commands.push(requiredCommand(cc, ['-DBEND_CUDA=1', `-I${toolkit}/include`, `-L${toolkit}/lib64`, `-L${toolkit}/lib`, cudaC, ...flags, '-lcuda', '-lnvrtc', '-o', cuda]));
  const cpuDependencies = requiredCommand('ldd', [cpu]);
  const cudaDependencies = requiredCommand('ldd', [cuda]);
  commands.push(cpuDependencies, cudaDependencies);
  assert.doesNotMatch(cpuDependencies.stdout, /libcuda|libnvrtc|not found/);
  assert.match(cudaDependencies.stdout, /libcuda\.so/);
  assert.match(cudaDependencies.stdout, /libnvrtc\.so/);
  assert.doesNotMatch(cudaDependencies.stdout, /not found/);
  const generated = command(cuda, ['+RTS', '--gpu-build', '-RTS']);
  commands.push(generated);
  const deviceArtifact = `${cuda}.gpu`;
  const bunVersion = requiredCommand(bun, ['--version']);
  const bendVersion = requiredCommand(bun, [resolve(source, 'bend2/main.ts'), 'version']);
  const cudaVersion = requiredCommand(resolve(toolkit, 'bin/nvcc'), ['--version']);
  commands.push(bunVersion, bendVersion, cudaVersion);
  assert.equal(sourceSha256(root), sourceHash, 'Source changed during build');
  const manifest = { schemaVersion: 1, cpu, cuda, deviceArtifact, deviceArtifactStatus: 'not-finalized', sourceRoot: root, sourceSha256: sourceHash,
    deviceBuild: { commandStatus: generated.status, exists: existsSync(deviceArtifact), detail: generated.stderr, verified: false },
    toolchain: { node: process.version, revision, clang: compiler.stdout.trim(), cudaHome: toolkit, cudaVersion: cudaVersion.stdout.trim(), bun: bunVersion.stdout.trim(), bend: bendVersion.stdout.trim() },
    artifacts: [cpu, cpuC, cuda, cudaC].map(path => ({ path, sha256: sha256(path) })),
    dependencies: { cpu: cpuDependencies.stdout, cuda: cudaDependencies.stdout },
    instrumentation: { kind: 'runtime-cuda-synchronization', marker: synchronizedBatch, hook: synchronization }, commands };
  writeFileSync(resolve(output, 'build.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  assert.ok(args.length === 0 || args.length === 2, 'Usage: node scripts/build/cuda.ts [SOURCE_ROOT OUTPUT_DIRECTORY]');
  const manifest = buildCuda({ sourceRoot: args[0], output: args[1] });
  const fallback = command(process.execPath, [fileURLToPath(new URL('../conformance/gpu.ts', import.meta.url)), 'fallback', resolve(manifest.cpu, '..')]);
  process.stdout.write(JSON.stringify({ build: manifest, fallback }, null, 2) + '\n');
  if (fallback.status !== 0) process.exitCode = 1;
}
