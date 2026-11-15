import { mkdirSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { run } from './toolchain.ts';

if (process.platform !== 'linux' || process.arch !== 'x64') {
  throw new Error('This optional local Clang setup supports Ubuntu 24.04 x64 only. Install Clang >=14 for your platform.');
}
const downloads = resolve('.toolchain/clang-packages');
const destination = resolve('.toolchain/clang');
mkdirSync(downloads, { recursive: true });
mkdirSync(destination, { recursive: true });
run('apt-get', ['download', ...['clang-18', 'libclang-cpp18', 'libllvm18', 'libclang-common-18-dev']
  .map(name => `${name}=1:18.1.3-1ubuntu1`)], downloads);
for (const file of readdirSync(downloads).filter(file => file.endsWith('.deb'))) {
  run('dpkg-deb', ['-x', resolve(downloads, file), destination]);
}
process.stdout.write(`Clang extracted to ${destination}; build scripts select it automatically.\n`);
