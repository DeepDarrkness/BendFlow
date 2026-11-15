import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createZstdDecompress } from 'node:zlib';
import { projectPath } from '../../src/paths.ts';
import { run } from '../lib/toolchain.ts';

if (process.platform !== 'linux' || process.arch !== 'x64') {
  throw new Error('This local Lean setup supports Linux x64 only. Install Lean 4.34.0 for your platform.');
}

const release = '4.34.0';
const revision = '293d5d0c0c3f3dded4688b3ccd6a33939ac5102b';
const archiveName = `lean-${release}-linux.tar.zst`;
const url = `https://github.com/leanprover/lean4/releases/download/v${release}/${archiveName}`;
// SHA256 published on the official leanprover/lean4 v4.34.0 release asset.
const sha256 = 'caaa98356098c85dc0fcbbd28e1ec66f39eb6551829972b752ff20e1286b646b';
const destination = projectPath('.toolchain/lean');

function installedVersion(directory: string): string {
  const version = run(`${directory}/bin/lean`, ['--version']);
  assert.equal(version, `Lean (version ${release}, x86_64-unknown-linux-gnu, commit ${revision}, Release)`,
    `Unexpected Lean toolchain in ${directory}`);
  return version;
}

async function install(): Promise<string> {
  if (existsSync(destination)) return installedVersion(destination);

  const downloads = projectPath('.toolchain/lean-packages');
  mkdirSync(downloads, { recursive: true });
  const archive = process.env.LEAN_ARCHIVE ? resolve(process.env.LEAN_ARCHIVE) : `${downloads}/${archiveName}`;
  if (!process.env.LEAN_ARCHIVE && !existsSync(archive)) {
    const partial = `${archive}.part`;
    try {
      run('curl', ['--fail', '--location', '--retry', '3', '--output', partial, url]);
      renameSync(partial, archive);
    } finally {
      rmSync(partial, { force: true });
    }
  }
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(archive)) hash.update(chunk);
  assert.equal(hash.digest('hex'), sha256, `Lean archive checksum mismatch: ${archive}; expected official release ${url}`);

  const staging = mkdtempSync(projectPath('.toolchain/lean-install-'));
  try {
    const tar = `${staging}/archive.tar`;
    await pipeline(createReadStream(archive), createZstdDecompress(), createWriteStream(tar));
    run('tar', ['-xf', tar, '--strip-components=1', '-C', staging]);
    rmSync(tar);
    const version = installedVersion(staging);
    renameSync(staging, destination);
    return version;
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

try {
  process.stdout.write(await install() + '\n');
  process.stdout.write(`Lean installed in ${destination}; build and test scripts select it automatically.\n`);
} catch (error) {
  throw new Error('Local Lean setup failed. Check Node 24, curl, tar, archive integrity, and available disk space. '
    + `If ${destination} contains a different or broken installation, remove it and rerun npm run setup:lean.`, { cause: error });
}
