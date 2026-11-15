import assert from 'node:assert/strict';
import { sessionKindSchema, sessionIdSchema } from '../contracts/apps.ts';
import { createAppClient } from '../src/client.ts';

const [url, rawKind, path, existingId, rawResourceId] = process.argv.slice(2);
if (!url || !path) throw new Error('Usage: app-client URL KIND PATH [SESSION_ID RESOURCE_ID]');
const kind = sessionKindSchema.parse(rawKind);
const remote = createAppClient(url);
const sessionId = existingId ? sessionIdSchema.parse(existingId) : (await remote.sessions.create({ kind })).sessionId;
function report(reply: unknown) {
  process.stdout.write(JSON.stringify({ clientPid: process.pid, sessionId, kind, reply }) + '\n');
}

switch (kind) {
  case 'numeric':
    report(await remote.numeric.command({ sessionId, command: { kind: 'add', amount: 7 } }));
    break;
  case 'collection':
    report(await remote.collection.command({ sessionId, command: { kind: 'put', key: 'k', value: 'v' } }));
    assert.deepEqual(await remote.collection.command({ sessionId, command: { kind: 'get', key: 'k' } }), { kind: 'text', text: 'v' });
    break;
  case 'file': {
    if (existingId) {
      const id = Number(rawResourceId);
      report(await remote.file.command({ sessionId, command: { kind: 'size', id } }));
      report(await remote.file.command({ sessionId, command: { kind: 'close', id } }));
      report(await remote.file.command({ sessionId, command: { kind: 'size', id } }));
      break;
    }
    const opened = await remote.file.command({ sessionId, command: { kind: 'open', path, mode: 'w' } });
    if (opened.kind !== 'opened') throw new Error('Expected opened');
    report(opened);
    const failed = await remote.file.command({ sessionId, command: { kind: 'read', id: opened.id, max: 8 } });
    assert.equal(failed.kind, 'fail');
    report(failed);
    report(await remote.file.command({ sessionId, command: { kind: 'write', id: opened.id, bytes: Buffer.from('from child') } }));
    break;
  }
  case 'network': {
    const opened = await remote.network.command({ sessionId, command: { kind: 'bind', host: '127.0.0.1', port: 0 } });
    if (opened.kind !== 'opened') throw new Error('Expected opened');
    report(opened);
    assert.deepEqual(await remote.network.command({ sessionId, command: { kind: 'close', id: opened.id } }), { kind: 'ok' });
    break;
  }
  case 'task': {
    const started = await remote.task.command({ sessionId, command: { kind: 'start', ms: 0, text: 'job' } });
    if (started.kind !== 'started') throw new Error('Expected started');
    report(await remote.task.command({ sessionId, command: { kind: 'join', id: started.id } }));
    break;
  }
  case 'process':
    report(await remote.process.command({ sessionId, command: { kind: 'run', program: '/bin/echo', arg: 'ok', input: '' } }));
    break;
  case 'compute':
    assert.deepEqual(await remote.compute.command({ sessionId, command: { kind: 'sum', items: [1, 2, 3, 4] } }), { kind: 'sum', value: 10 });
    report(await remote.compute.command({ sessionId, command: { kind: 'frame' } }));
    break;
  case 'custom':
    report(await remote.custom.command({ sessionId, command: { kind: 'mark', path } }));
    break;
}
if (kind !== 'file' || existingId) report(await remote.sessions.close({ sessionId }));
