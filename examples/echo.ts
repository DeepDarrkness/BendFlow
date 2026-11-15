import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { BendWorker } from '../src/worker.ts';

const worker = await BendWorker.start({ executable: resolve('build/echo-worker') });
try {
  for (const payload of [Buffer.from([0, 128, 255]), Buffer.from('Hello BendRT'), Buffer.alloc(0)]) {
    const response = await worker.echo(payload);
    assert.deepEqual(response, payload);
    process.stdout.write(JSON.stringify({ pid: worker.pid, sent: [...payload], received: [...response] }) + '\n');
  }
} finally {
  await worker.close();
}
