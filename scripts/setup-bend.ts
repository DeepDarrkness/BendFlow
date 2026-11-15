import { existsSync, mkdirSync } from 'node:fs';
import { revision, run, source } from './toolchain.ts';

mkdirSync('.toolchain', { recursive: true });
if (!existsSync(source)) {
  run('git', ['init', source]);
  run('git', ['remote', 'add', 'origin', 'https://github.com/bendlang/bend.git'], source);
}
run('git', ['fetch', '--depth=1', 'origin', revision], source);
run('git', ['checkout', '--detach', revision], source);
process.stdout.write(`Bend source pinned to ${run('git', ['rev-parse', 'HEAD'], source)}\n`);
