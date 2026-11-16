import { randomUUID, createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, relative, resolve } from 'node:path';
import { inspectServices, type WireBounds } from '../services/inspect.ts';
import { contractId, emitClient, emitContracts, emitNative, emitServer, emitWorker } from '../services/emit.ts';
import { bun, clang, revision, run, source } from '../lib/toolchain.ts';
import { projectPath } from '../../src/paths.ts';

const format = 'BendFlow/services/v1';

export function buildServices(options: { entry: string; out: string } & WireBounds): void {
  if (process.versions.node.split('.')[0] !== '24') throw new Error('Node 24 is required');
  const entry = resolve(options.entry);
  const out = resolve(options.out);
  const description = inspectServices(entry, options);
  if (existsSync(out) && (!existsSync(resolve(out, 'build.json')) || JSON.parse(readFileSync(resolve(out, 'build.json'), 'utf8')).format !== format)) {
    throw new Error('Output directory is not a generated BendFlow service package');
  }
  mkdirSync(dirname(out), { recursive: true });
  const stage = mkdtempSync(resolve(dirname(out), '.services-stage-'));
  const backup = `${out}.previous-${randomUUID()}`;
  const modulePath = (path: string) => {
    const value = relative(out, projectPath(path));
    return value.startsWith('.') ? value : `./${value}`;
  };
  try {
    mkdirSync(resolve(stage, 'runtime'));
    mkdirSync(resolve(stage, 'native'));
    for (const file of description.sources) {
      const destination = resolve(stage, 'source', relative(dirname(entry), file));
      mkdirSync(dirname(destination), { recursive: true });
      copyFileSync(file, destination);
    }
    const staged = inspectServices(resolve(stage, 'source', basename(entry)), options);
    const services = staged.services;
    const runtimeFiles = ['loop.bend', 'transport.bend', 'bytes.bend', 'utf8.bend'];
    for (const file of runtimeFiles) {
      copyFileSync(projectPath('bend', file), resolve(stage, 'runtime', file));
    }
    copyFileSync(projectPath('scripts/services/runtime.bend'), resolve(stage, 'runtime/wire.bend'));
    writeFileSync(resolve(stage, 'contract.ts'), emitContracts(services, modulePath('contracts/apps.ts')));
    writeFileSync(resolve(stage, 'native.ts'), emitNative(services, {
      codec: modulePath('src/protocol/codec.ts'), bytes: modulePath('src/protocol/bytes.ts'), host: modulePath('src/service-host.ts'),
    }));
    writeFileSync(resolve(stage, 'server.ts'), emitServer(services, { host: modulePath('src/service-host.ts'), worker: modulePath('src/worker.ts') }));
    writeFileSync(resolve(stage, 'client.ts'), emitClient(modulePath('src/protocol/framing.ts')));
    writeFileSync(resolve(stage, 'index.ts'), "export { startGateway } from './server.ts';\nexport { createClient } from './client.ts';\nexport * from './contract.ts';\n");
    for (const service of services) {
      const input = resolve(stage, `worker-${service.name}.bend`);
      writeFileSync(input, emitWorker(service, entry, staged.imports));
      run(bun, [resolve(source, 'bend2/main.ts'), input, '-o', resolve(stage, 'native', `worker-${service.name}`)]);
    }
    writeFileSync(resolve(stage, 'tsconfig.json'), JSON.stringify({ extends: modulePath('tsconfig.json'), include: ['./*.ts'] }, null, 2) + '\n');
    run(process.execPath, [projectPath('node_modules/typescript/bin/tsc'), '--project', resolve(stage, 'tsconfig.json')]);
    writeFileSync(resolve(stage, 'description.json'), JSON.stringify({ version: 2, services }, null, 2) + '\n');
    const hash = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');
    writeFileSync(resolve(stage, 'build.json'), JSON.stringify({ format, compiler: revision, node: process.version,
      clang: run(clang, ['--version']).split('\n')[0],
      scope: 'pure/io/stateful recursive bounded Wire Data; repository runtime dependencies; native CPU',
      sources: description.sources.map(file => ({ path: relative(dirname(entry), file), hash: hash(resolve(stage, 'source', relative(dirname(entry), file))) })),
      runtime: [...runtimeFiles, 'wire.bend'].map(file => ({ path: file, hash: hash(resolve(stage, 'runtime', file)) })),
      services: services.map(service => ({ name: service.name, contract: contractId(service),
        executable: `native/worker-${service.name}`, hash: hash(resolve(stage, 'native', `worker-${service.name}`)) })),
    }, null, 2) + '\n');
    if (existsSync(out)) renameSync(out, backup);
    try { renameSync(stage, out); }
    catch (error) {
      if (existsSync(backup)) renameSync(backup, out);
      throw error;
    }
    rmSync(backup, { recursive: true, force: true });
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  let entry = projectPath('examples/services/counter.bend');
  let out = projectPath('build/services');
  const bounds: WireBounds = {};
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    const value = args[++index];
    if (!value || !['--entry', '--out', '--max-text', '--max-items'].includes(key ?? '')) throw new Error('Usage: services.ts [--entry FILE] [--out DIRECTORY] [--max-text N] [--max-items N]');
    if (key === '--entry') entry = resolve(value);
    else if (key === '--out') out = resolve(value);
    else if (key === '--max-text') bounds.maxText = Number(value);
    else bounds.maxItems = Number(value);
  }
  buildServices({ entry, out, ...bounds });
  process.stdout.write(`Generated typed native services in ${out}\n`);
}
