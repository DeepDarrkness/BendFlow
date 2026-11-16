import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from 'node:net';
import { NativeApp } from '../../src/app.ts';
import { projectPath } from '../../src/paths.ts';
import { listen } from '../support/servers.ts';
import { startGateway, createClient } from '../../build/portable-services/index.ts';
import { packetCodec, natCodec, floatCodec, unitsCodec, nestedCodec, overflow_textCodec, overflow_natCodec, overflow_listCodec, forkCodec, services } from '../../build/portable-services/native.ts';
import { resourceCodec, loopbackCodec, processCodec, channelCodec } from '../../build/effect-services/native.ts';
import { startGateway as startEffects, createClient as effectsClient } from '../../build/effect-services/index.ts';
import { buildServices } from '../../scripts/build/services.ts';
import { writeFileSync } from 'node:fs';
import { external } from '../support/subprocess.ts';

const packet = { enabled: true, count: '281474976710655', ratio: { bits: 0x7fc12345 }, title: '\ufeff🌍', numbers: [0x01020304, 0xffffffff],
  choice: { kind: 'Present', fields: { kind: 7, text: 'é' } }, box: { value: { value: 9 } }, empty: {} } satisfies ReturnType<typeof packetCodec.parse>['value'];
const packetBytes = Buffer.from([1, 255, 255, 255, 255, 255, 255, 127, 193, 35, 69, 7, 239, 187, 191, 240, 159, 140, 141,
  2, 1, 2, 3, 4, 255, 255, 255, 255, 1, 0, 0, 0, 7, 2, 195, 169, 0, 0, 0, 9]);

test('general native wire tree agrees with independent golden bytes and rejects every truncation and malformed nested value', async t => {
  const app = await NativeApp.start(packetCodec, { executable: projectPath('build/portable-services/native/worker-packet') });
  t.after(() => app.close());
  assert.deepEqual(packetCodec.encode({value: packet}), packetBytes);
  assert.deepEqual(await app.raw(packetBytes), Buffer.concat([Buffer.from([0]), packetBytes]));
  assert.deepEqual(await app.command({value: packet}), packet);
  for (let length = 0; length < packetBytes.length; length++) {
    assert.deepEqual(await app.raw(packetBytes.subarray(0, length)), Buffer.from([255]), `truncation ${length}`);
    assert.throws(() => packetCodec.decode(Buffer.concat([Buffer.from([0]), packetBytes.subarray(0, length)])));
  }
  for (const [offset, value] of [[0, 2], [11, 17], [12, 255], [19, 5], [28, 2]]) {
    const bad = Buffer.from(packetBytes);
    if (offset === undefined || value === undefined) throw new Error('Expected malformed vector');
    bad[offset] = value;
    assert.deepEqual(await app.raw(bad), Buffer.from([255]));
    assert.throws(() => packetCodec.decode(Buffer.concat([Buffer.from([0]), bad])));
  }
  const trailing = Buffer.concat([packetBytes, Buffer.from([0])]);
  assert.deepEqual(await app.raw(trailing), Buffer.from([255]));
  assert.throws(() => packetCodec.decode(Buffer.concat([Buffer.from([0]), trailing])));
  assert.deepEqual(await app.command({value: {...packet, choice: {kind: 'Absent', fields: {}}}}), {...packet, choice: {kind: 'Absent', fields: {}}});
  for (const value of [{...packet, extra: 1}, {...packet, count: '281474976710656'}, {...packet, title: '\ud800'},
    {...packet, choice: {kind: 'Present', fields: {kind: 7, text: 'ok', extra: 0}}}]) assert.throws(() => packetCodec.encode(packetCodec.parse({value})));
});

test('native Nat48 F32 bit patterns bounded nested lists and zero-width Unit lists preserve values', async t => {
  const n = await NativeApp.start(natCodec, {executable: projectPath('build/portable-services/native/worker-nat')});
  const f = await NativeApp.start(floatCodec, {executable: projectPath('build/portable-services/native/worker-float')});
  const u = await NativeApp.start(unitsCodec, {executable: projectPath('build/portable-services/native/worker-units')});
  const l = await NativeApp.start(nestedCodec, {executable: projectPath('build/portable-services/native/worker-nested')});
  t.after(() => Promise.all([n.close(), f.close(), u.close(), l.close()]));
  for (const value of ['0', '4294967296', '281474976710655']) assert.equal(await n.command({value}), value);
  assert.deepEqual(natCodec.encode({value: '281474976710655'}), Buffer.from([255,255,255,255,255,255]));
  for (const bits of [0, 0x80000000, 0x7f800000, 0xff800000, 0x7fc12345, 0xffffffff]) assert.deepEqual(await f.command({value: {bits}}), {bits});
  assert.deepEqual(await u.raw(Buffer.from([4])), Buffer.from([0,4]));
  assert.deepEqual(await u.command({value: [null,null,null,null]}), [null,null,null,null]);
  assert.deepEqual(await u.raw(Buffer.from([5])), Buffer.from([255]));
  assert.deepEqual(await l.command({value: [[1,2],[],[0xffffffff]]}), [[1,2],[],[0xffffffff]]);
  assert.deepEqual(await l.raw(Buffer.from([0])), Buffer.from([0,0]));
});

test('typed and raw HTTP matrix invokes every portable service and retains state with multiple external arguments', async t => {
  const gateway = await startGateway();
  t.after(() => gateway.close());
  const client = createClient(gateway.url);
  const matrix: readonly [string, unknown, unknown][] = [
    ['add',{a:7,b:5},12], ['answer',{},42], ['unit',{value:null},null], ['pair',{value:[7,true]},[7,true]],
    ['packet',{value:packet},packet], ['nested',{value:[[1],[]]},[[1],[]]], ['units',{value:[null]},[null]],
    ['greet',{name:'Bend'},'Hello, Bend'], ['nat',{value:'281474976710655'},'281474976710655'],
    ['float',{value:{bits:0x80000000}},{bits:0x80000000}], ['float_add',{a:{bits:0x3fc00000},b:{bits:0x40100000}},{bits:0x40700000}],
    ['divide',{a:12,b:0},{kind:'Bad',fields:{code:1}}], ['fork',{},4096], ['proved',{value:'19'},'19'], ['store',{index:2,value:9,write:true},{cell:9,last:9}],
  ];
  assert.deepEqual(services.map(value => value.name).sort(), [...matrix.map(([name]) => name), 'overflow_nat', 'overflow_text', 'overflow_list'].sort());
  for (const [service,args,expected] of matrix) {
    const created = await fetch(`${gateway.url}/sessions/create`, {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({json:{service}})});
    assert.equal(created.status,200);
    const session = await created.json();
    const response = await fetch(`${gateway.url}/${service}`, {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({json:{sessionId:session.json.sessionId,args}})});
    assert.equal(response.status,200,service);
    assert.deepEqual(await response.json(),{json:expected},service);
    await client.sessions.close({sessionId:session.json.sessionId});
  }
  const {sessionId} = await client.sessions.create({service:'store'});
  assert.deepEqual(await client.store({sessionId,args:{index:0,value:7,write:true}}),{cell:7,last:7});
  assert.deepEqual(await client.store({sessionId,args:{index:1,value:12,write:true}}),{cell:12,last:12});
  assert.deepEqual(await client.store({sessionId,args:{index:0,value:0,write:false}}),{cell:7,last:12});
  const add = await client.sessions.create({service:'add'});
  assert.equal(await client.add({sessionId:add.sessionId,args:{a:7,b:5}}),12);
  const nat = await client.sessions.create({service:'nat'});
  for (const value of ['x','01','-1','1.5','281474976710656','9'.repeat(100)]) {
    const response = await fetch(`${gateway.url}/nat`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({json:{sessionId:nat.sessionId,args:{value}}})});
    assert.equal(response.status,400,value); await response.text();
  }
  assert.equal(await client.nat({sessionId:nat.sessionId,args:{value:'7'}}),'7');
  const division = await client.sessions.create({service:'divide'});
  assert.deepEqual(await client.divide({sessionId:division.sessionId,args:{a:12,b:0}}),{kind:'Bad',fields:{code:1}});
  assert.deepEqual(await client.divide({sessionId:division.sessionId,args:{a:12,b:3}}),{kind:'Good',fields:{value:4}});
  const fork = await NativeApp.start(forkCodec,{executable:projectPath('build/portable-services/native/worker-fork'),threads:2});
  t.after(() => fork.close());
  assert.equal(await fork.command({}),4096);
});

test('bounded IO resource worker rejects malformed input without effects and finalizes its affine handle exactly once', async t => {
  const root = mkdtempSync(projectPath('build/general-resource-'));
  t.after(() => rmSync(root,{recursive:true,force:true}));
  const path = resolve(root,'observed.txt');
  const app = await NativeApp.start(resourceCodec,{executable:projectPath('build/effect-services/native/worker-resource'),env:{BENDFLOW_SERVICE_FILE:path}});
  t.after(() => app.close());
  for (const payload of [Buffer.from([1,65]),Buffer.from([1,65,2]),Buffer.from([1,255,1]),Buffer.from([1,65,1,0]),Buffer.from([97])]) {
    assert.deepEqual(await app.raw(payload),Buffer.from([255]));
    assert.equal(readFileSync(path,'utf8'),'');
  }
  assert.equal(await app.command({text:'Bend',enabled:true}),true);
  assert.equal(await app.command({text:'ignored',enabled:false}),false);
  assert.equal(readFileSync(path,'utf8'),'Bend');
  await app.close(); await app.close();
  assert.equal(readFileSync(path,'utf8'),'Bend|closed');
  assert.equal(app.diagnostics.split('resource finalized').length - 1,1);
  assert.throws(() => process.kill(app.pid,0),{code:'ESRCH'});
});

test('controlled process channel and loopback network services perform native finite effects', async t => {
  const p = await NativeApp.start(processCodec,{executable:projectPath('build/effect-services/native/worker-process')});
  const c = await NativeApp.start(channelCodec,{executable:projectPath('build/effect-services/native/worker-channel')});
  const l = await NativeApp.start(loopbackCodec,{executable:projectPath('build/effect-services/native/worker-loopback')});
  t.after(() => Promise.all([p.close(),c.close(),l.close()]));
  assert.deepEqual(await p.command({input:'Bend\n'}),{kind:'Success',fields:{status:0,stdout:'Bend\n',stderr:''}});
  assert.equal(await c.command({value:'\ufeff🌍'}),'\ufeff🌍');
  let connections = 0;
  const observed = new Promise<Buffer>(resolve => {
    const server = createServer(socket => {connections++; const chunks: Buffer[]=[];socket.on('data',chunk => chunks.push(chunk));socket.on('end',() => resolve(Buffer.concat(chunks)));});
    void listen(t,server).then(async port => {
      assert.deepEqual(await l.raw(Buffer.from([0,0,0])),Buffer.from([255]));
      assert.equal(connections,0);
      assert.equal(await l.command({port}),true);
    });
  });
  assert.deepEqual(await observed,Buffer.from([66,101,110,100]));
  assert.equal(connections,1);
});

test('outsize text and native Nat overflow never emit a successful truncated reply', async t => {
  const list = await NativeApp.start(overflow_listCodec,{executable:projectPath('build/portable-services/native/worker-overflow_list')});
  t.after(() => list.close());
  assert.deepEqual(await list.raw(Buffer.alloc(0)),Buffer.from([255]));
  for (const [name,codec] of [['overflow_text',overflow_textCodec],['overflow_nat',overflow_natCodec]] satisfies [string,typeof overflow_textCodec][]) {
    const app = await NativeApp.start(codec,{executable:projectPath(`build/portable-services/native/worker-${name}`)});
    t.after(() => app.close());
    if (name === 'overflow_text') assert.deepEqual(await app.raw(Buffer.alloc(0)),Buffer.from([255]));
    else {
      await assert.rejects(app.raw(Buffer.alloc(0)));
      await app.close();
      assert.match(app.diagnostics,/Nat past the largest immediate/);
    }
  }
});

test('explicit large text bounds and default text/list policies execute natively without hidden decoder fuel limits', async t => {
  const root = mkdtempSync(projectPath('build/general-large-text-'));
  t.after(() => rmSync(root,{recursive:true,force:true}));
  const entry = resolve(root,'text.bend');
  writeFileSync(entry,'import Base\ndef Text() -> Data:\n  String\ndef Duo() -> Type:\n  U32 & Bool\ndef api.pair(value: Duo()) -> Duo():\n  value\ndef api.text(value: Text()) -> String:\n  value\ndef api.list(value: List<&2, U32>) -> List<&2, U32>:\n  value\n');
  const out = resolve(root,'large');
  buildServices({entry,out,maxText:200});
  const result = await external(process.execPath,['--input-type=module','-e',`
    import {textCodec,listCodec,pairCodec} from ${JSON.stringify(resolve(out,'native.ts'))};
    import {NativeApp} from ${JSON.stringify(projectPath('src/app.ts'))};
    const app = await NativeApp.start(textCodec,{executable:${JSON.stringify(resolve(out,'native/worker-text'))}});
    const list = await NativeApp.start(listCodec,{executable:${JSON.stringify(resolve(out,'native/worker-list'))}});
    const pair = await NativeApp.start(pairCodec,{executable:${JSON.stringify(resolve(out,'native/worker-pair'))}});
    try {
      const text = 'x'.repeat(200);
      const raw = await app.raw(Buffer.concat([Buffer.from([200]),Buffer.from(text)]));
      process.stdout.write(JSON.stringify({text:await app.command({value:text}),bytes:[...raw],tooLong:[...await app.raw(Buffer.concat([Buffer.from([201]),Buffer.from(text+'x')]))],list:await list.command({value:Array.from({length:32},(_,i)=>i)}),listTooLong:[...await list.raw(Buffer.from([33]))],pair:await pair.command({value:[7,true]})}));
    } finally {await app.close();await list.close();await pair.close();}
  `]);
  assert.equal(result.stderr,'');
  assert.deepEqual(JSON.parse(result.stdout),{text:'x'.repeat(200),bytes:[0,200,...Array.from({length:200},()=>120)],tooLong:[255],list:Array.from({length:32},(_,i)=>i),listTooLong:[255],pair:[7,true]});
  assert.throws(() => buildServices({entry,out,maxText:247}),/reply with tag 249 exceeds 248/);
});

test('effect services also expose exact generated HTTP contracts including observed resource finalization', async t => {
  const root = mkdtempSync(projectPath('build/general-http-resource-'));
  t.after(() => rmSync(root,{recursive:true,force:true}));
  const path = resolve(root,'observed.txt');
  const gateway = await startEffects({worker:{env:{BENDFLOW_SERVICE_FILE:path}}});
  t.after(() => gateway.close());
  const client = effectsClient(gateway.url);
  const resource = await client.sessions.create({service:'resource'});
  const bad = await fetch(`${gateway.url}/resource`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({json:{sessionId:resource.sessionId,args:{text:'not written',enabled:2}}})});
  assert.equal(bad.status,400); await bad.text();
  assert.equal(readFileSync(path,'utf8'),'');
  assert.equal(await client.resource({sessionId:resource.sessionId,args:{text:'HTTP',enabled:true}}),true);
  await client.sessions.close({sessionId:resource.sessionId});
  assert.equal(readFileSync(path,'utf8'),'HTTP|closed');
  const process = await client.sessions.create({service:'process'});
  assert.deepEqual(await client.process({sessionId:process.sessionId,args:{input:'HTTP'}}),{kind:'Success',fields:{status:0,stdout:'HTTP',stderr:''}});
  const channel = await client.sessions.create({service:'channel'});
  assert.equal(await client.channel({sessionId:channel.sessionId,args:{value:'HTTP'}}),'HTTP');
  const loopback = await client.sessions.create({service:'loopback'});
  let done: (bytes: Buffer) => void = () => {};
  const observed = new Promise<Buffer>(resolve => {done = resolve;});
  const port = await listen(t,createServer(socket => {const chunks:Buffer[]=[];socket.on('data',chunk => chunks.push(chunk));socket.on('end',() => done(Buffer.concat(chunks)));}));
  assert.equal(await client.loopback({sessionId:loopback.sessionId,args:{port}}),true);
  assert.deepEqual(await observed,Buffer.from([66,101,110,100]));
});
