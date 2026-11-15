import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { z } from 'zod';
import { projectPath } from '../../src/paths.ts';
import { run } from '../lib/toolchain.ts';

if (process.platform !== 'linux' || process.arch !== 'x64') {
  throw new Error('This local CUDA setup supports Linux x64 only. Install the CUDA toolkit for your platform.');
}

const release = '13.1.0';
const base = 'https://developer.download.nvidia.com/compute/cuda/redist/';
const components = ['cuda_cccl', 'cuda_crt', 'cuda_cudart', 'cuda_nvcc', 'cuda_nvrtc', 'libnvvm'];
const archiveSchema = z.object({
  relative_path: z.string().regex(/^[a-z0-9_/-]+\/[a-z0-9_.-]+\.tar\.xz$/),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
const componentSchema = z.object({ 'linux-x86_64': archiveSchema });
const response = await fetch(`${base}redistrib_${release}.json`);
if (!response.ok) throw new Error(`CUDA manifest download failed: HTTP ${response.status}`);
const manifest = z.object({ release_label: z.literal(release) }).catchall(z.unknown()).parse(await response.json());
const destination = projectPath('.toolchain/cuda');
const downloads = projectPath('.toolchain/cuda-packages');
mkdirSync(downloads, { recursive: true });
mkdirSync(destination, { recursive: true });
mkdirSync(`${destination}/licenses`, { recursive: true });

for (const name of components) {
  const entry = componentSchema.parse(manifest[name])['linux-x86_64'];
  const archive = `${downloads}/${basename(entry.relative_path)}`;
  if (!existsSync(archive)) {
    run('curl', ['--fail', '--location', '--retry', '3', '--output', archive, `${base}${entry.relative_path}`]);
  }
  const digest = createHash('sha256').update(readFileSync(archive)).digest('hex');
  assert.equal(digest, entry.sha256, `CUDA archive checksum mismatch: ${name}`);
  run('tar', ['-xJf', archive, '--strip-components=1', '-C', destination]);
  if (existsSync(`${destination}/LICENSE`)) copyFileSync(`${destination}/LICENSE`, `${destination}/licenses/${name}.txt`);
}

writeFileSync(`${destination}/redistrib.json`, JSON.stringify({ release, components, manifest }, null, 2) + '\n');
process.stdout.write(run(`${destination}/bin/nvcc`, ['--version']) + '\n');
process.stdout.write(`CUDA ${release} build components installed in ${destination}. Build scripts select them automatically.\n`);
// The pinned Bend CUDA runtime requires concurrent managed access, which WSL2 lacks.
// Finalize <executable>.gpu and test full GPU functionality on a CUDA-compatible
// native Linux GPU system. WSL2 can compile the CUDA-enabled host executable only.
process.stdout.write('Bend GPU artifact generation and GPU tests require a CUDA-compatible native Linux GPU system with concurrent managed access.\n');
