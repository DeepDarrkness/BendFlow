import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { app } from '../support/native.ts';
import { fileCodec } from '../../src/protocol/apps.ts';
import { BytesWriter } from '../../src/protocol/bytes.ts';
import { scratch } from '../support/resources.ts';
import { createAppClient } from '../../src/client.ts';
import { gateway } from '../support/gateways.ts';
import { MAX_FILE_IDS } from '../../contracts/file.ts';
import { collectSnapshot } from '../../contracts/pages.ts';

test('every file command rejects truncation and trailing bytes before effects or ownership changes',async t=>{
  const dir=await scratch(t),path=join(dir,'all-raw');await writeFile(path,'kept');
  const session=await app(t,fileCodec,'file');const opened=await session.command({kind:'open',path,mode:'r+'});if(opened.kind!=='opened')throw new Error('opened');
  const snapshot=await session.command({kind:'capture',id:opened.id});if(snapshot.kind!=='snapshot')throw new Error('snapshot');
  const commands:import('../../contracts/file.ts').FileCommand[]=[{kind:'open',path,mode:'w'},
    {kind:'write',id:opened.id,bytes:Buffer.from('bad')},{kind:'read',id:opened.id,max:192},{kind:'size',id:opened.id},
    {kind:'readAt',id:opened.id,offset:0,max:192},{kind:'writeAt',id:opened.id,offset:0,bytes:Buffer.from('bad')},
    {kind:'close',id:opened.id},{kind:'capture',id:opened.id},{kind:'page',snapshot:snapshot.snapshot,offset:0,max:192},{kind:'release',snapshot:snapshot.snapshot}];
  for(const command of commands){
    const encoded=fileCodec.encode(command);
    for(let end=0;end<encoded.length;end++)assert.deepEqual(fileCodec.decode(await session.raw(encoded.subarray(0,end))),{kind:'invalidCommand'});
    assert.deepEqual(fileCodec.decode(await session.raw(Buffer.concat([encoded,Buffer.from([0])]))),{kind:'invalidCommand'});
    assert.deepEqual(await readFile(path),Buffer.from('kept'));
    assert.deepEqual(await session.command({kind:'size',id:opened.id}),{kind:'size',value:4});
    assert.deepEqual(await session.command({kind:'page',snapshot:snapshot.snapshot,offset:0,max:192}),{kind:'page',snapshot:snapshot.snapshot,offset:0,total:4,count:4,done:true,data:Buffer.from('kept')});
  }
  assert.deepEqual(await session.command({kind:'read',id:opened.id,max:192}),{kind:'bytes',bytes:Buffer.from('kept')});
  const next=await session.command({kind:'open',path,mode:'r'});assert.deepEqual(next,{kind:'opened',id:2});
});

test('file snapshots freeze maximum binary results and preserve handles after oversized capture', async t => {
  const dir = await scratch(t), path = join(dir, 'pages');
  const bytes = Buffer.from(Array.from({length:65536},(_,i)=>i%256));
  await writeFile(path, bytes);
  const session = await app(t,fileCodec,'file',{callMs:10_000});
  const opened=await session.command({kind:'open',path,mode:'r+'});
  if(opened.kind!=='opened')throw new Error('opened');
  const snapshot=await session.command({kind:'capture',id:opened.id});
  if(snapshot.kind!=='snapshot')throw new Error('snapshot');
  assert.equal(snapshot.total,65536);
  await session.command({kind:'writeAt',id:opened.id,offset:0,bytes:Buffer.from('changed')});
  const expected=Buffer.from(bytes);expected.set(Buffer.from('changed'));
  assert.deepEqual(await readFile(path),expected);
  const parts:Buffer[]=[];
  for(let offset=0;offset<65536;offset+=192){
    const page=await session.command({kind:'page',snapshot:snapshot.snapshot,offset,max:192});
    if(page.kind!=='page')throw new Error('page');
    assert.equal(page.offset,offset);assert.equal(page.total,65536);assert.equal(page.count,Math.min(192,65536-offset));
    assert.equal(page.done,offset+page.count===65536);parts.push(Buffer.from(page.data));
  }
  assert.deepEqual(Buffer.concat(parts),bytes);
  const final={kind:'page',snapshot:snapshot.snapshot,offset:65536,total:65536,count:0,done:true,data:Buffer.alloc(0)};
  for(let i=0;i<2;i++)assert.deepEqual(await session.command({kind:'page',snapshot:snapshot.snapshot,offset:65536,max:192}),final);
  assert.deepEqual(await session.command({kind:'page',snapshot:snapshot.snapshot,offset:65537,max:192}),{kind:'invalidOffset'});
  await writeFile(path,Buffer.alloc(65537,4));
  assert.deepEqual(await session.command({kind:'capture',id:opened.id}),{kind:'limit'});
  const still=await session.command({kind:'page',snapshot:snapshot.snapshot,offset:0,max:1});
  if(still.kind!=='page')throw new Error('page');assert.deepEqual(still.data,bytes.subarray(0,1));
  assert.deepEqual(await session.command({kind:'size',id:opened.id}),{kind:'size',value:65537});
  for(let i=0;i<2;i++)assert.deepEqual(await session.command({kind:'release',snapshot:snapshot.snapshot}),{kind:'ok'});
  assert.deepEqual(await session.command({kind:'page',snapshot:snapshot.snapshot,offset:0,max:1}),{kind:'stale'});
  await writeFile(path,Buffer.alloc(0));
  const empty=await session.command({kind:'capture',id:opened.id});
  if(empty.kind!=='snapshot')throw new Error('snapshot');
  assert.notEqual(empty.snapshot,snapshot.snapshot);
  assert.deepEqual(await session.command({kind:'release',snapshot:snapshot.snapshot}),{kind:'ok'});
  assert.deepEqual(await session.command({kind:'page',snapshot:empty.snapshot,offset:0,max:192}),{kind:'page',snapshot:empty.snapshot,offset:0,total:0,count:0,done:true,data:Buffer.alloc(0)});
});

test('HTTP files append Unicode and maximum binary chunks with EOF and independent disk observers',async t=>{
  const server=await gateway(t),client=createAppClient(server.url),other=createAppClient(server.url);
  const dir=await scratch(t),path=join(dir,'unicode');
  const {sessionId}=await client.sessions.create({kind:'file'});
  const command=(command:import('../../contracts/file.ts').FileCommand)=>client.file.command({sessionId,command});
  const opened=await command({kind:'open',path,mode:'w'});if(opened.kind!=='opened')throw new Error('opened');
  assert.deepEqual(await readFile(path),Buffer.alloc(0));
  await command({kind:'write',id:opened.id,bytes:Buffer.alloc(0)});assert.deepEqual(await readFile(path),Buffer.alloc(0));
  await command({kind:'close',id:opened.id});
  const reading=await command({kind:'open',path,mode:'r'});if(reading.kind!=='opened')throw new Error('opened');
  assert.deepEqual(await command({kind:'read',id:reading.id,max:192}),{kind:'bytes',bytes:new Uint8Array(0)});
  const append=await command({kind:'open',path,mode:'a'});if(append.kind!=='opened')throw new Error('opened');
  const unicode=Buffer.from('λ 雪 😀\u0000');
  const binary=Buffer.from(Array.from({length:192},(_,i)=>i));
  let expected=Buffer.alloc(0);
  for(const bytes of [unicode,binary,unicode]){
    assert.deepEqual(await command({kind:'write',id:append.id,bytes}),{kind:'ok'});
    expected=Buffer.concat([expected,bytes]);assert.deepEqual(await readFile(path),expected);
  }
  const received:Buffer[]=[];
  for(let i=0;i<3;i++){
    const result=await other.file.command({sessionId,command:{kind:'read',id:reading.id,max:192}});
    if(result.kind!=='bytes')throw new Error('bytes');received.push(Buffer.from(result.bytes));
  }
  assert.deepEqual(Buffer.concat(received),expected);
  for(let i=0;i<2;i++)assert.deepEqual(await command({kind:'read',id:reading.id,max:192}),{kind:'bytes',bytes:new Uint8Array(0)});
  const snap=await command({kind:'capture',id:reading.id});if(snap.kind!=='snapshot')throw new Error('snapshot');
  await command({kind:'write',id:append.id,bytes:Buffer.from('tail')});
  assert.deepEqual(await readFile(path),Buffer.concat([expected,Buffer.from('tail')]));
  const chunks:Buffer[]=[];
  for(let offset=0;offset<snap.total;offset+=192){
    const page=await command({kind:'page',snapshot:snap.snapshot,offset,max:192});if(page.kind!=='page')throw new Error('page');chunks.push(Buffer.from(page.data));
  }
  assert.deepEqual(Buffer.concat(chunks),expected);
  assert.deepEqual(Buffer.from(await collectSnapshot({descriptor:snap,totalLimit:65536,pageCap:192,
    read:(offset,max)=>command({kind:'page',snapshot:snap.snapshot,offset,max})})),expected);
  const failed=await command({kind:'read',id:append.id,max:1});assert.equal(failed.kind,'fail');
  await command({kind:'write',id:append.id,bytes:Buffer.from('ok')});assert.deepEqual(await readFile(path),Buffer.concat([expected,Buffer.from('tailok')]));
  await command({kind:'close',id:append.id});
  assert.deepEqual(await command({kind:'size',id:append.id}),{kind:'missing'});
});

test('HTTP file resource IDs exhaust without replacement and remain isolated with multiple handles',async t=>{
  const server=await gateway(t),client=createAppClient(server.url);
  const dir=await scratch(t),path=join(dir,'ids'),otherPath=join(dir,'other');
  await writeFile(path,'kept');await writeFile(otherPath,'other');
  const a=await client.sessions.create({kind:'file'}),b=await client.sessions.create({kind:'file'});
  const call=(command:import('../../contracts/file.ts').FileCommand)=>client.file.command({sessionId:a.sessionId,command});
  const ids:number[]=[];
  for(let i=0;i<MAX_FILE_IDS;i++){
    const reply=await call({kind:'open',path,mode:'r'});if(reply.kind!=='opened')throw new Error('opened');assert.equal(reply.id,i+1);ids.push(reply.id);
  }
  const failedPath=join(dir,'must-not-create');
  assert.deepEqual(await call({kind:'open',path:failedPath,mode:'w'}),{kind:'exhausted'});
  await assert.rejects(readFile(failedPath),{code:'ENOENT'});
  for(const id of [1,MAX_FILE_IDS])assert.deepEqual(await call({kind:'read',id,max:192}),{kind:'bytes',bytes:new Uint8Array(Buffer.from('kept'))});
  assert.deepEqual(await client.file.command({sessionId:b.sessionId,command:{kind:'size',id:1}}),{kind:'missing'});
  const own=await client.file.command({sessionId:b.sessionId,command:{kind:'open',path:otherPath,mode:'r'}});if(own.kind!=='opened')throw new Error('opened');assert.equal(own.id,1);
  await call({kind:'close',id:1});
  assert.deepEqual(await call({kind:'open',path,mode:'r'}),{kind:'exhausted'});
  assert.deepEqual(await call({kind:'size',id:1}),{kind:'missing'});
  assert.deepEqual(await client.file.command({sessionId:b.sessionId,command:{kind:'read',id:own.id,max:192}}),{kind:'bytes',bytes:new Uint8Array(Buffer.from('other'))});
  assert.deepEqual(await call({kind:'size',id:MAX_FILE_IDS}),{kind:'size',value:4});
});

test('file raw malformed modes IDs writes and paging do not change disk or handle position',async t=>{
  const dir=await scratch(t),path=join(dir,'raw');await writeFile(path,Buffer.from([0,255,128,7]));
  const session=await app(t,fileCodec,'file');const opened=await session.command({kind:'open',path,mode:'r+'});if(opened.kind!=='opened')throw new Error('opened');
  const malformed=[
    new BytesWriter().u8(0).text(path).text('w+').toBuffer(),new BytesWriter().u8(0).text(path+'\0').text('w').toBuffer(),
    new BytesWriter().u8(1).u32(0).bytes(Buffer.from('bad')).toBuffer(),new BytesWriter().u8(8).u32(0).u32(0).u32(192).toBuffer(),
    new BytesWriter().u8(8).u32(1).u32(0).u32(193).toBuffer(),new BytesWriter().u8(8).u32(1).u32(0).u32(0).toBuffer(),
    Buffer.concat([fileCodec.encode({kind:'write',id:opened.id,bytes:Buffer.from('bad')}),Buffer.from([0])]),Buffer.from([1,0,0,0,1,193]),Buffer.from([254]),Buffer.from([0,1,128]),
  ];
  for(const raw of malformed){
    assert.deepEqual(fileCodec.decode(await session.raw(raw)),{kind:'invalidCommand'});assert.deepEqual(await readFile(path),Buffer.from([0,255,128,7]));
  }
  assert.deepEqual(fileCodec.decode(await session.raw(fileCodec.encode({kind:'read',id:opened.id,max:192}))),{kind:'bytes',bytes:Buffer.from([0,255,128,7])});
  assert.deepEqual(await session.command({kind:'read',id:opened.id,max:192}),{kind:'bytes',bytes:Buffer.alloc(0)});
});

test('file workspace retains a handle across write, size, read, and close', async t => {
  const dir = await scratch(t);
  const path = join(dir, 'note.bin');
  const session = await app(t, fileCodec, 'file', { callMs: 4000 });
  const opened = await session.command({ kind: 'open', path, mode: 'w' });
  assert.equal(opened.kind, 'opened');
  if (opened.kind !== 'opened') throw new Error('expected opened');
  assert.deepEqual(await session.command({ kind: 'write', id: opened.id, bytes: Buffer.from('hi') }), { kind: 'ok' });
  assert.deepEqual(await session.command({ kind: 'size', id: opened.id }), { kind: 'size', value: 2 });
  assert.deepEqual(await session.command({ kind: 'close', id: opened.id }), { kind: 'ok' });
  assert.equal(await readFile(path, 'utf8'), 'hi');
  const reading = await session.command({ kind: 'open', path, mode: 'r' });
  assert.equal(reading.kind, 'opened');
  if (reading.kind !== 'opened') throw new Error('expected opened');
  const got = await session.command({ kind: 'read', id: reading.id, max: 8 });
  assert.equal(got.kind, 'bytes');
  if (got.kind !== 'bytes') throw new Error('expected bytes');
  assert.equal(Buffer.from(got.bytes).toString('utf8'), 'hi');
  await session.command({ kind: 'close', id: reading.id });
  assert.deepEqual(await session.command({ kind: 'size', id: reading.id }), { kind: 'missing' });
});

test('failed file read keeps the handle for a later write', async t => {
  const dir = await scratch(t);
  const path = join(dir, 'keep.bin');
  const session = await app(t, fileCodec, 'file', { callMs: 4000 });
  const opened = await session.command({ kind: 'open', path, mode: 'w' });
  assert.equal(opened.kind, 'opened');
  if (opened.kind !== 'opened') throw new Error('expected opened');
  const failed = await session.command({ kind: 'read', id: opened.id, max: 8 });
  assert.equal(failed.kind, 'fail');
  assert.deepEqual(await session.command({ kind: 'write', id: opened.id, bytes: Buffer.from('kept') }), { kind: 'ok' });
  await session.command({ kind: 'close', id: opened.id });
  assert.equal(await readFile(path, 'utf8'), 'kept');
});

test('file offset write and read are visible on disk', async t => {
  const dir = await scratch(t);
  const path = join(dir, 'offset.bin');
  const session = await app(t, fileCodec, 'file', { callMs: 4000 });
  const created = await session.command({ kind: 'open', path, mode: 'w' });
  assert.equal(created.kind, 'opened');
  if (created.kind !== 'opened') throw new Error('expected opened');
  assert.deepEqual(await session.command({ kind: 'write', id: created.id, bytes: Buffer.from('abcd') }), { kind: 'ok' });
  await session.command({ kind: 'close', id: created.id });
  const opened = await session.command({ kind: 'open', path, mode: 'r+' });
  assert.equal(opened.kind, 'opened');
  if (opened.kind !== 'opened') throw new Error('expected opened');
  assert.deepEqual(await session.command({ kind: 'writeAt', id: opened.id, offset: 1, bytes: Buffer.from('XY') }), { kind: 'ok' });
  const got = await session.command({ kind: 'readAt', id: opened.id, offset: 0, max: 8 });
  assert.equal(got.kind, 'bytes');
  if (got.kind !== 'bytes') throw new Error('expected bytes');
  assert.equal(Buffer.from(got.bytes).toString('utf8'), 'aXYd');
  await session.command({ kind: 'close', id: opened.id });
  assert.equal(await readFile(path, 'utf8'), 'aXYd');
});

test('exclusive create fails when the path exists and later commands still work', async t => {
  const dir = await scratch(t);
  const path = join(dir, 'exists.bin');
  await writeFile(path, 'old');
  const session = await app(t, fileCodec, 'file', { callMs: 4000 });
  const failed = await session.command({ kind: 'open', path, mode: 'x' });
  assert.equal(failed.kind, 'fail');
  const opened = await session.command({ kind: 'open', path, mode: 'r' });
  assert.equal(opened.kind, 'opened');
});

test('raw oversized file reads are rejected before advancing the retained handle', async t => {
  const dir = await scratch(t);
  const path = join(dir, 'bounded.bin');
  await writeFile(path, Buffer.alloc(200, 7));
  const session = await app(t, fileCodec, 'file', { callMs: 4000 });
  const opened = await session.command({ kind: 'open', path, mode: 'r' });
  if (opened.kind !== 'opened') throw new Error('expected opened');
  const reads = [
    new BytesWriter().u8(2).u32(opened.id).u32(193).toBuffer(),
    new BytesWriter().u8(4).u32(opened.id).u32(0).u32(193).toBuffer(),
  ];
  for (const raw of reads) assert.deepEqual(fileCodec.decode(await session.raw(raw)), { kind: 'invalidCommand' });
  const first = await session.command({ kind: 'read', id: opened.id, max: 192 });
  if (first.kind !== 'bytes') throw new Error('expected bytes');
  assert.deepEqual(first.bytes, Buffer.alloc(192, 7));
  const last = await session.command({ kind: 'read', id: opened.id, max: 192 });
  if (last.kind !== 'bytes') throw new Error('expected bytes');
  assert.deepEqual(last.bytes, Buffer.alloc(8, 7));
});
