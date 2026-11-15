import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { startSessionGateway } from '../src/server.ts';

const gateway = await startSessionGateway();
process.stdout.write(JSON.stringify({ gatewayPid: process.pid, workerPid: gateway.workerPid, url: gateway.url }) + '\n');
const client = spawn(process.execPath, [resolve('examples/session-client.ts'), gateway.url], { stdio: 'inherit' });
const timer = setTimeout(() => client.kill('SIGKILL'), 10_000);
try {
  await new Promise<void>((resolve, reject) => {
    client.once('error', reject);
    client.once('close', (code, signal) => code === 0 ? resolve() : reject(new Error(`Client failed: ${signal ?? code}`)));
  });
} finally {
  clearTimeout(timer);
  client.kill('SIGKILL');
  await gateway.close();
}
