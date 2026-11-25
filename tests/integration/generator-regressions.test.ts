import assert from 'node:assert/strict';
import test from 'node:test';
import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildServices } from '../../scripts/build/services.ts';
import { inspectServices } from '../../scripts/services/inspect.ts';
import { projectPath } from '../../src/paths.ts';
import { external } from '../support/subprocess.ts';

test('nested pair lifecycle and plain and generic IO aliases execute through native HTTP', async t => {
  const root = mkdtempSync(projectPath('build/generator-lifecycle-'));
  t.after(() => rmSync(root, {recursive:true,force:true}));
  for (const fixture of ['pair-state', 'io-alias']) {
    const out = resolve(root, fixture);
    buildServices({entry:projectPath(`tests/fixtures/services/${fixture}.bend`),out});
    const result = await external(process.execPath, ['--input-type=module','-e', `
      import {startGateway,createClient} from ${JSON.stringify(resolve(out,'index.ts'))};
      const gateway = await startGateway();
      const client = createClient(gateway.url);
      try {
        const session = await client.sessions.create({service:'answer'});
        const answer = await client.answer({sessionId:session.sessionId,args:{}});
        await client.sessions.close({sessionId:session.sessionId});
        const values = [answer];
        const nested = await client.sessions.create({service:'nested'});
        values.push(await client.nested({sessionId:nested.sessionId,args:{}}));
        await client.sessions.close({sessionId:nested.sessionId});
        if (${JSON.stringify(fixture)} === 'io-alias') {
          const generic = await client.sessions.create({service:'generic'});
          values.push(await client.generic({sessionId:generic.sessionId,args:{}}));
          await client.sessions.close({sessionId:generic.sessionId});
          const state = await client.sessions.create({service:'state'});
          values.push(await client.state({sessionId:state.sessionId,args:{}}));
          values.push(await client.state({sessionId:state.sessionId,args:{}}));
          await client.sessions.close({sessionId:state.sessionId});
        }
        process.stdout.write(JSON.stringify(values));
      } finally {await gateway.close();}
    `]);
    assert.equal(result.stderr, '');
    assert.deepEqual(JSON.parse(result.stdout), fixture === 'pair-state' ? [42,42] : [42,44,43,41,42]);
  }
});

test('Unit-heavy list maximum JSON crosses 4096 bytes and reaches the native HTTP worker', async t => {
  const root = mkdtempSync(projectPath('build/generator-json-'));
  t.after(() => rmSync(root, {recursive:true,force:true}));
  const out = resolve(root,'package');
  buildServices({entry:projectPath('tests/fixtures/services/unit-markers.bend'),out});
  const result = await external(process.execPath, ['--input-type=module','-e', `
    import assert from 'node:assert/strict';
    import {startGateway,createClient} from ${JSON.stringify(resolve(out,'index.ts'))};
    import {markersCodec} from ${JSON.stringify(resolve(out,'native.ts'))};
    const gateway = await startGateway();
    const client = createClient(gateway.url);
    try {
      const {sessionId} = await client.sessions.create({service:'markers'});
      const marker = Object.fromEntries([... 'abcdefghijklmnop'].map(key => [key,null]));
      const args = {value:Array.from({length:32},()=>marker)};
      assert.deepEqual(markersCodec.encode(args),Buffer.from([32]));
      const body = JSON.stringify({json:{sessionId,args}});
      assert.ok(Buffer.byteLength(body) > 4096);
      const response = await fetch(gateway.url+'/markers',{method:'POST',headers:{'content-type':'application/json'},body});
      assert.equal(response.status,200);
      assert.deepEqual(await response.json(),{json:args.value});
      const escaped = body.replace(/"([^"]*)"/g,(_,value) => '"'+[...value].map(char => '\\\\u'+char.charCodeAt(0).toString(16).padStart(4,'0')).join('')+'"');
      const maximum = await fetch(gateway.url+'/markers',{method:'POST',headers:{'content-type':'application/json'},body:escaped});
      assert.equal(maximum.status,200);
      assert.deepEqual(await maximum.json(),{json:args.value});
      assert.throws(() => markersCodec.parse({value:[...args.value,marker]}));
      const tooLarge = await fetch(gateway.url+'/markers',{method:'POST',headers:{'content-type':'application/json'},body:body+' '.repeat(20000)});
      assert.equal(tooLarge.status,413);
      await tooLarge.text();
      await client.sessions.close({sessionId});
      process.stdout.write(JSON.stringify({bytes:Buffer.byteLength(body),escapedBytes:Buffer.byteLength(escaped)}));
    } finally {await gateway.close();}
  `]);
  assert.equal(result.stderr, '');
  assert.deepEqual(JSON.parse(result.stdout), {bytes:4752,escapedBytes:7602});
});

test('real native compiler failure after staging preserves an invokable prior package', async t => {
  const root = mkdtempSync(projectPath('build/generator-preservation-'));
  t.after(() => rmSync(root, {recursive:true,force:true}));
  const unavailableClang = resolve(root,'unavailable-clang');
  writeFileSync(unavailableClang, '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "unavailable clang"; exit 0; fi\nexit 1\n');
  chmodSync(unavailableClang, 0o755);
  const entry = projectPath('tests/fixtures/services/unit-markers.bend');
  const out = resolve(root,'package');
  buildServices({entry,out});
  const manifest = readFileSync(resolve(out,'build.json'));
  assert.equal(inspectServices(entry).services[0]?.name,'markers');
  const result = await external(process.execPath, ['--input-type=module','-e', `
    process.env.CC = ${JSON.stringify(unavailableClang)};
    const {buildServices} = await import(${JSON.stringify(projectPath('scripts/build/services.ts'))});
    try {buildServices({entry:${JSON.stringify(entry)},out:${JSON.stringify(out)}});process.exitCode=1;}
    catch (error) {
      if (!error.message.includes('worker-markers.bend -o')) throw error;
      process.stdout.write('native compilation rejected');
    }
  `]);
  assert.equal(result.stdout,'native compilation rejected');
  assert.match(result.stderr,/unavailable-clang/);
  assert.deepEqual(readFileSync(resolve(out,'build.json')),manifest);
  assert.deepEqual(readdirSync(root),['package']);
  const invoked = await external(process.execPath, ['--input-type=module','-e', `
    import {startGateway,createClient} from ${JSON.stringify(resolve(out,'index.ts'))};
    const gateway = await startGateway();
    try {
      const client = createClient(gateway.url);
      const {sessionId} = await client.sessions.create({service:'markers'});
      process.stdout.write(JSON.stringify(await client.markers({sessionId,args:{value:[]}})));
      await client.sessions.close({sessionId});
    } finally {await gateway.close();}
  `]);
  assert.equal(invoked.stderr,'');
  assert.equal(invoked.stdout,'[]');
});
