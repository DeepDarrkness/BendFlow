import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { NativeApp } from '../../src/app.ts';
import { ServiceHost } from '../../src/service-host.ts';
import { projectPath } from '../../src/paths.ts';
import { startGateway, createClient } from '../../build/data-services/index.ts';
import { glyphCodec, shapeCodec, tupleCodec, repeatCodec, observedCodec, observedService, invalidCodec, workService } from '../../build/data-services/native.ts';

const scalars: readonly [string, readonly number[]][] = [
  ['\0',[0,0,0,0]], ['\u007f',[0,0,0,127]], ['\u0080',[0,0,0,128]],
  ['\ud7ff',[0,0,215,255]], ['\ue000',[0,0,224,0]], ['\uffff',[0,0,255,255]],
  ['\u{10000}',[0,1,0,0]], ['😀',[0,1,246,0]], ['\u{10ffff}',[0,16,255,255]],
];
const invalidBytes = [[0,0,216,0],[0,0,223,255],[0,17,0,0],[255,255,255,255]];
const invalidJson: unknown[] = ['', 'ab', 'e\u0301', '\ud800', '\udfff', 65, {code:65}, null];

test('Char native U32BE agrees with scalar goldens and rejects invalid ingress and egress', async t => {
  const app = await NativeApp.start(glyphCodec,{executable:projectPath('build/data-services/native/worker-glyph')});
  const invalid = await NativeApp.start(invalidCodec,{executable:projectPath('build/data-services/native/worker-invalid')});
  t.after(() => Promise.all([app.close(),invalid.close()]));
  for (const [value,bytes] of scalars) {
    const payload = Buffer.from(bytes);
    assert.deepEqual(glyphCodec.encode({value}),payload);
    assert.deepEqual(await app.raw(payload),Buffer.from([0,...bytes]));
    assert.equal(await app.command({value}),value);
    assert.equal(glyphCodec.decode(Buffer.from([0,...bytes])),value);
    for (let n=0;n<4;n++) {
      assert.deepEqual(await app.raw(payload.subarray(0,n)),Buffer.from([255]));
      assert.throws(() => glyphCodec.decode(Buffer.from([0,...bytes.slice(0,n)])));
    }
  }
  for (const bytes of invalidBytes) {
    assert.deepEqual(await app.raw(Buffer.from(bytes)),Buffer.from([255]));
    assert.throws(() => glyphCodec.decode(Buffer.from([0,...bytes])),/Unicode scalar/);
    assert.deepEqual(await invalid.raw(Buffer.from(bytes)),Buffer.from([255]));
  }
  assert.deepEqual(await app.raw(Buffer.from([0,0,0,65,0])),Buffer.from([255]));
  assert.throws(() => glyphCodec.decode(Buffer.from([0,0,0,0,65,0])));
  for (const value of invalidJson) assert.throws(() => glyphCodec.parse({value}));
  assert.equal(await app.command({value:'A'}),'A');
});

test('nested Char records unions tuples and reusable Data lists retain JSON array shapes', async t => {
  const app = await NativeApp.start(shapeCodec,{executable:projectPath('build/data-services/native/worker-shape')});
  const tuple = await NativeApp.start(tupleCodec,{executable:projectPath('build/data-services/native/worker-tuple')});
  const repeat = await NativeApp.start(repeatCodec,{executable:projectPath('build/data-services/native/worker-repeat')});
  t.after(() => Promise.all([app.close(),tuple.close(),repeat.close()]));
  const value = {glyph:'😀',rows:[['A','\u{10ffff}'],[]],choice:{kind:'Letters',fields:{values:['\ue000']}}} satisfies ReturnType<typeof shapeCodec.parse>['value'];
  const bytes = Buffer.from([0,1,246,0,2,2,0,0,0,65,0,16,255,255,0,1,1,0,0,224,0]);
  assert.deepEqual(shapeCodec.encode({value}),bytes);
  assert.deepEqual(await app.raw(bytes),Buffer.concat([Buffer.from([0]),bytes]));
  assert.deepEqual(await app.command({value}),value);
  for (let n=0;n<bytes.length;n++) {
    assert.deepEqual(await app.raw(bytes.subarray(0,n)),Buffer.from([255]));
    assert.throws(() => shapeCodec.decode(Buffer.concat([Buffer.from([0]),bytes.subarray(0,n)])));
  }
  for (const offset of [0,6,10,17]) {
    const bad = Buffer.from(bytes);
    bad.set([0,0,216,0],offset);
    assert.deepEqual(await app.raw(bad),Buffer.from([255]));
    assert.throws(() => shapeCodec.decode(Buffer.concat([Buffer.from([0]),bad])));
  }
  assert.deepEqual(await tuple.command({value:['\0',[['😀','A'],'\u{10ffff}']]}),['\0',[['😀','A'],'\u{10ffff}']]);
  assert.deepEqual(await repeat.command({value:['A','😀']}),['A','😀','A','😀']);
  assert.deepEqual(await repeat.raw(Buffer.from([3,0,0,0,65,0,0,0,66,0,0,0,67])),Buffer.from([255]));
});

test('invalid raw scalar and nested Char requests preserve affine state and have no invocation effects', async t => {
  const root = mkdtempSync(projectPath('build/char-effects-'));
  t.after(() => rmSync(root,{recursive:true,force:true}));
  const path = resolve(root,'observed.txt');
  const app = await NativeApp.start(observedCodec,{executable:projectPath('build/data-services/native/worker-observed'),env:{BENDFLOW_SERVICE_FILE:path}});
  t.after(() => app.close());
  assert.deepEqual(await app.command({value:'A',letters:[]}),['A',1]);
  const invalid = [Buffer.alloc(0),Buffer.from([0,0,0]),Buffer.from([0,0,0,65]),Buffer.from([0,0,0,65,0,0]),
    ...invalidBytes.map(bytes => Buffer.from([...bytes,0])),
    ...invalidBytes.map(bytes => Buffer.from([0,0,0,65,1,...bytes])),Buffer.from([0,0,0,65,1,0,0,0])];
  for (const bytes of invalid) {
    assert.deepEqual(await app.raw(bytes),Buffer.from([255]));
    assert.equal(readFileSync(path,'utf8'),'A');
  }
  assert.deepEqual(await app.command({value:'😀',letters:['\0']}),['😀',2]);
  await app.close(); await app.close();
  assert.equal(readFileSync(path,'utf8'),'A😀|closed');
  assert.equal(app.diagnostics.split('char finalized').length-1,1);
});

test('generated Char HTTP rejects malformed JSON before effects and shares nested values transparently', async t => {
  const root = mkdtempSync(projectPath('build/char-http-'));
  t.after(() => rmSync(root,{recursive:true,force:true}));
  const path = resolve(root,'observed.txt');
  const gateway = await startGateway({worker:{env:{BENDFLOW_SERVICE_FILE:path}}});
  t.after(() => gateway.close());
  const client = createClient(gateway.url);
  const {sessionId} = await client.sessions.create({service:'observed'});
  for (const args of [...invalidJson.map(value => ({value,letters:[]})),...invalidJson.map(value => ({value:'A',letters:[value]}))]) {
    const response = await fetch(`${gateway.url}/observed`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({json:{sessionId,args}})});
    assert.equal(response.status,400); await response.text();
    assert.equal(readFileSync(path,'utf8'),'');
  }
  assert.deepEqual(await client.observed({sessionId,args:{value:'😀',letters:['\0']}}),['😀',1]);
  const glyph = await client.sessions.create({service:'glyph'});
  for (const [value] of scalars) assert.equal(await client.glyph({sessionId:glyph.sessionId,args:{value}}),value);
  const shape = await client.sessions.create({service:'shape'});
  const value = {glyph:'😀',rows:[['A'],[]],choice:{kind:'NoLetters',fields:{}}} satisfies ReturnType<typeof shapeCodec.parse>['value'];
  assert.deepEqual(await client.shape({sessionId:shape.sessionId,args:{value}}),value);
  await client.sessions.close({sessionId});
  assert.equal(readFileSync(path,'utf8'),'😀|closed');
});

function cpuTicks(pid: number): Map<string,number> {
  return new Map(readdirSync(`/proc/${pid}/task`).map(tid => {
    const stat = readFileSync(`/proc/${pid}/task/${tid}/stat`,'utf8');
    const fields = stat.slice(stat.lastIndexOf(')')+2).split(' ');
    return [tid,Number(fields[11])+Number(fields[12])];
  }));
}

test('same generated session observes default two and explicit one/four CPU lanes doing balanced work', async t => {
  for (const threads of [undefined,1,4]) {
    const expected = threads ?? 2;
    const host = new ServiceHost([workService],{worker:{threads,callMs:60000,env:{BENDRTS:'--gpu 1GB --threads 64'}}});
    t.after(() => host.close());
    const {sessionId} = await host.create('work');
    const pid = host.workerPids[0];
    assert.ok(pid);
    if (process.platform === 'linux') {
      const args = readFileSync(`/proc/${pid}/cmdline`,'utf8').split('\0');
      assert.deepEqual(args.slice(1,7),['+RTS','--threads',String(expected),'--gpu','off','-RTS']);
    }
    assert.deepEqual(await host.invoke(workService,sessionId,{depth:'12'}),{threads:expected,sum:4096,calls:1});
    const before = process.platform === 'linux' ? cpuTicks(pid) : new Map<string,number>();
    const abort = new AbortController();
    const first = host.invoke(workService,sessionId,{depth:'28'},{signal:abort.signal});
    const next = host.invoke(workService,sessionId,{depth:'12'});
    abort.abort();
    assert.deepEqual(await first,{threads:expected,sum:268435456,calls:2});
    if (process.platform === 'linux') {
      const active = [...cpuTicks(pid)].filter(([tid,ticks]) => ticks-(before.get(tid) ?? 0) >= 2);
      assert.equal(active.length,expected,`CPU lanes with sustained evaluation ticks: ${JSON.stringify(active)}`);
    }
    assert.deepEqual(await next,{threads:expected,sum:4096,calls:3});
    await host.close();
  }
});

test('thread counts reject before startup and runtime extra GPU profiles cannot override CPU policy', async t => {
  let starts = 0;
  const counted = {...workService,start:async (...args:Parameters<typeof workService.start>) => {
    starts++;
    return workService.start(...args);
  }};
  for (const threads of [0,-1,1.5,65,NaN,Infinity]) {
    assert.throws(() => new ServiceHost([counted],{worker:{threads}}),RangeError);
  }
  // @ts-expect-error Plain JavaScript callers can supply a nonnumeric thread count.
  assert.throws(() => new ServiceHost([counted],{worker:{threads:'4'}}),RangeError);
  // @ts-expect-error Null must not select the default thread count.
  assert.throws(() => new ServiceHost([counted],{worker:{threads:null}}),RangeError);
  assert.equal(starts,0);
  const root = mkdtempSync(projectPath('build/char-startup-'));
  t.after(() => rmSync(root,{recursive:true,force:true}));
  const path = resolve(root,'never-initialized.txt');
  for (const threads of [0,65,1.5]) {
    await assert.rejects(observedService.start({threads,env:{BENDFLOW_SERVICE_FILE:path}}),RangeError);
    assert.equal(existsSync(path),false);
  }
  const worker = {threads:4,profile:'gpu'};
  const direct = await workService.start(worker);
  t.after(() => direct.close());
  assert.deepEqual(await direct.command({depth:'12'}),{threads:4,sum:4096,calls:1});
  const host = new ServiceHost([workService],{worker});
  t.after(() => host.close());
  const {sessionId} = await host.create('work');
  assert.deepEqual(await host.invoke(workService,sessionId,{depth:'12'}),{threads:4,sum:4096,calls:1});
  if (process.platform === 'linux') {
    const pid = host.workerPids[0];
    assert.ok(pid);
    assert.match(readFileSync(`/proc/${pid}/cmdline`,'utf8'),/--gpu\0off\0/);
  }
});
