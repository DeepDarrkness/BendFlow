import { mkdirSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { run } from '../lib/toolchain.ts';
import { projectPath } from '../../src/paths.ts';

if (process.platform !== 'linux' || process.arch !== 'x64') {
  throw new Error('This optional local Clang setup supports Ubuntu 24.04 x64 only. Install Clang >=14 for your platform.');
}
const downloads = projectPath('.toolchain/clang-packages');
const destination = projectPath('.toolchain/clang');
const requested = process.argv[2] ?? '18';
const versions = { '18': '1:18.1.3-1ubuntu1', '19': '1:19.1.1-1ubuntu1~24.04.2' };
if (requested !== '18' && requested !== '19') throw new Error('Expected Clang version 18 or 19.');
mkdirSync(downloads, { recursive: true });
mkdirSync(destination, { recursive: true });
run('apt-get', ['download', ...[`clang-${requested}`, `libclang-cpp${requested}`, `libllvm${requested}`, `libclang-common-${requested}-dev`]
  .map(name => `${name}=${versions[requested]}`)], downloads);
for (const file of readdirSync(downloads).filter(file => file.endsWith('.deb'))) {
  run('dpkg-deb', ['-x', resolve(downloads, file), destination]);
}
process.stdout.write(`Clang extracted to ${destination}; build scripts select it automatically.\n`);
