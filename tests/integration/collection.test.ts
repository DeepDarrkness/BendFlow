import assert from 'node:assert/strict';
import test from 'node:test';
import { app } from '../support/native.ts';
import { collectionCodec } from '../../src/protocol/apps.ts';
import { BytesWriter } from '../../src/protocol/bytes.ts';
import { createAppClient } from '../../src/client.ts';
import { gateway } from '../support/gateways.ts';
import { z } from 'zod';
import { nestedRecordSchema } from '../../contracts/collection.ts';
import { collectSnapshot } from '../../contracts/pages.ts';

test('every collection command rejects truncation and trailing bytes without changing retained state',async t=>{
  const session=await app(t,collectionCodec,'collection');
  await session.command({kind:'put',key:'k',value:'kept'});await session.command({kind:'setItems',items:[3,1,2]});
  await session.command({kind:'arraySet',index:1,value:77});await session.command({kind:'storeClosure',amount:7});
  const snapshot=await session.command({kind:'capture'});if(snapshot.kind!=='snapshot')throw new Error('snapshot');
  const record={name:'n',point:[1,2],optional:3,choice:{kind:'number',value:4},items:[5]} satisfies z.infer<typeof nestedRecordSchema>;
  await session.command({kind:'putNested',record});
  const commands:import('../../contracts/collection.ts').CollectionCommand[]=[
    {kind:'put',key:'k',value:'bad'},{kind:'get',key:'k'},{kind:'del',key:'k'},{kind:'setItems',items:[9]},
    {kind:'mapInc'},{kind:'sort'},{kind:'arraySet',index:1,value:9},{kind:'arrayGet',index:1},{kind:'read'},
    {kind:'appendItems',items:[9]},{kind:'capture'},{kind:'page',snapshot:snapshot.snapshot,offset:0,max:32},{kind:'release',snapshot:snapshot.snapshot},
    {kind:'putNested',record:{...record,name:'bad'}},{kind:'getNested'},{kind:'set',add:'x',remove:'y',has:'x'},{kind:'fold'},
    {kind:'transform',value:1,text:'x'},{kind:'storeClosure',amount:9},{kind:'consumeClosure',value:1},{kind:'sized'},
    {kind:'maybe',left:'1',right:'2'},{kind:'result',left:'1',right:'2'},
    {kind:'arrayRead'},
  ];
  for(const command of commands){
    const encoded=collectionCodec.encode(command);
    for(let end=0;end<encoded.length;end++)assert.deepEqual(collectionCodec.decode(await session.raw(encoded.subarray(0,end))),{kind:'invalidCommand'});
    assert.deepEqual(collectionCodec.decode(await session.raw(Buffer.concat([encoded,Buffer.from([0])]))),{kind:'invalidCommand'});
    assert.deepEqual(await session.command({kind:'get',key:'k'}),{kind:'text',text:'kept'});
    assert.deepEqual(await session.command({kind:'read'}),{kind:'items',items:[3,1,2]});
    assert.deepEqual(await session.command({kind:'arrayGet',index:1}),{kind:'cell',value:77});
    assert.deepEqual(await session.command({kind:'getNested'}),{kind:'nested',record});
    assert.deepEqual(await session.command({kind:'page',snapshot:snapshot.snapshot,offset:0,max:32}),{kind:'page',snapshot:snapshot.snapshot,offset:0,total:3,count:3,done:true,data:[3,1,2]});
  }
  assert.deepEqual(await session.command({kind:'consumeClosure',value:1}),{kind:'cell',value:8});
  assert.deepEqual(await session.command({kind:'set',add:'z',remove:'none',has:'x'}),{kind:'set',size:1,has:false});
});

test('collection snapshots reassemble maximum sorted multisets and survive mutation and release', async t => {
  const session = await app(t, collectionCodec, 'collection', { callMs: 10_000 });
  const input = Array.from({ length: 1024 }, (_, i) => (1023 - i) % 137);
  await session.command({ kind: 'arraySet', index: 3, value: 99 });
  for (let i = 0; i < input.length; i += 32) await session.command({ kind: 'appendItems', items: input.slice(i, i + 32) });
  assert.deepEqual(await session.command({ kind: 'appendItems', items: [1] }), { kind: 'limit' });
  assert.deepEqual(await session.command({ kind: 'sort' }), { kind: 'ok' });
  const descriptor = await session.command({ kind: 'capture' });
  if (descriptor.kind !== 'snapshot') throw new Error('snapshot');
  assert.equal(descriptor.total, 1024);
  await session.command({ kind: 'setItems', items: [9] });
  const result: number[] = [];
  for (let offset = 0; offset < 1024; offset += 32) {
    const page = await session.command({ kind: 'page', snapshot: descriptor.snapshot, offset, max: 32 });
    if (page.kind !== 'page') throw new Error('page');
    assert.equal(page.offset, offset); assert.equal(page.total, 1024); assert.equal(page.count, 32);
    assert.equal(page.done, offset === 992); result.push(...page.data);
  }
  assert.deepEqual(result, input.toSorted((a,b) => a-b));
  const final = { kind: 'page', snapshot: descriptor.snapshot, offset: 1024, total: 1024, count: 0, done: true, data: [] };
  for (let i = 0; i < 2; i++) assert.deepEqual(await session.command({ kind: 'page', snapshot: descriptor.snapshot, offset: 1024, max: 1 }), final);
  assert.deepEqual(await session.command({ kind: 'page', snapshot: descriptor.snapshot, offset: 1025, max: 32 }), { kind: 'invalidOffset' });
  for (let i = 0; i < 2; i++) assert.deepEqual(await session.command({ kind: 'release', snapshot: descriptor.snapshot }), { kind: 'ok' });
  assert.deepEqual(await session.command({ kind: 'page', snapshot: descriptor.snapshot, offset: 0, max: 32 }), { kind: 'stale' });
  const replacement=await session.command({kind:'capture'});if(replacement.kind!=='snapshot')throw new Error('snapshot');
  assert.notEqual(replacement.snapshot,descriptor.snapshot);
  assert.deepEqual(await session.command({kind:'page',snapshot:descriptor.snapshot,offset:0,max:32}),{kind:'stale'});
  assert.deepEqual(await session.command({kind:'release',snapshot:descriptor.snapshot}),{kind:'ok'});
  assert.deepEqual(await session.command({kind:'page',snapshot:replacement.snapshot,offset:0,max:32}),{kind:'page',snapshot:replacement.snapshot,offset:0,total:1,count:1,done:true,data:[9]});
  assert.deepEqual(await session.command({ kind: 'arrayGet', index: 7 }), { kind: 'cell', value: 99 });
});

test('collection maximum ascending descending duplicate lists and array capacity obey actual bounds',async t=>{
  const first=await app(t,collectionCodec,'collection',{callMs:10_000}),second=await app(t,collectionCodec,'collection');
  for(let index=0;index<4;index++)await first.command({kind:'arraySet',index,value:10+index});
  assert.deepEqual(await first.command({kind:'arrayRead'}),{kind:'items',items:[10,11,12,13]});
  for(const index of [0,1,2,3,4,5,6,7,0xffffffff]){
    assert.deepEqual(await first.command({kind:'arrayGet',index}),{kind:'cell',value:10+(index%4)});
    assert.deepEqual(await second.command({kind:'arrayGet',index}),{kind:'cell',value:0});
  }
  for(const input of [Array.from({length:1024},(_,i)=>i),Array.from({length:1024},(_,i)=>1023-i),Array(1024).fill(0xffffffff)]){
    await first.command({kind:'setItems',items:[]});
    for(let offset=0;offset<1024;offset+=32)await first.command({kind:'appendItems',items:input.slice(offset,offset+32)});
    assert.deepEqual(await first.command({kind:'sort'}),{kind:'ok'});
    const snapshot=await first.command({kind:'capture'});if(snapshot.kind!=='snapshot')throw new Error('snapshot');
    const sorted=await collectSnapshot({descriptor:snapshot,totalLimit:1024,pageCap:32,
      read:(offset,max)=>first.command({kind:'page',snapshot:snapshot.snapshot,offset,max})});
    assert.deepEqual(sorted,input.toSorted((a,b)=>a-b));
    await first.command({kind:'mapInc'});
    const next=await first.command({kind:'capture'});if(next.kind!=='snapshot')throw new Error('snapshot');
    assert.deepEqual(await collectSnapshot({descriptor:next,totalLimit:1024,pageCap:32,
      read:(offset,max)=>first.command({kind:'page',snapshot:next.snapshot,offset,max})}),sorted.map(x=>(x+1)>>>0));
    assert.deepEqual(await first.command({kind:'page',snapshot:snapshot.snapshot,offset:0,max:32}),{kind:'stale'});
  }
  assert.deepEqual(await first.command({kind:'arrayGet',index:0}),{kind:'cell',value:10});
  assert.deepEqual(await second.command({kind:'read'}),{kind:'items',items:[]});
});

test('collection native malformed pages and nested records have no effect and valid raw commands agree', async t => {
  const session = await app(t, collectionCodec, 'collection');
  const record = { name: 'λ😀', point: [1, 0xffffffff], optional: null, choice: { kind: 'text', text: '雪' }, items: [0, 0xffffffff, 9] } satisfies z.infer<typeof nestedRecordSchema>;
  assert.deepEqual(collectionCodec.decode(await session.raw(collectionCodec.encode({ kind: 'putNested', record }))), { kind: 'nested', record });
  await session.command({ kind: 'storeClosure', amount: 10 });
  const bad = [Buffer.from([254]), Buffer.from([13]), Buffer.concat([collectionCodec.encode({ kind: 'putNested', record }), Buffer.from([0])]),
    new BytesWriter().u8(11).u32(0).u32(0).u32(32).toBuffer(), new BytesWriter().u8(11).u32(1).u32(0).u32(0).toBuffer(),
    new BytesWriter().u8(11).u32(1).u32(0).u32(33).toBuffer(), Buffer.from([9,33]), Buffer.from([13,1,0x80])];
  for (const payload of bad) {
    assert.deepEqual(collectionCodec.decode(await session.raw(payload)), { kind: 'invalidCommand' });
    assert.deepEqual(await session.command({ kind: 'getNested' }), { kind: 'nested', record });
  }
  assert.deepEqual(await session.command({ kind: 'consumeClosure', value: 2 }), { kind: 'cell', value: 12 });
  for (const optional of [null, 0, 0xffffffff]) for (const choice of [{ kind: 'number', value: 0xffffffff }, { kind: 'text', text: '界'.repeat(8) }] satisfies Array<import('zod').infer<typeof import('../../contracts/collection.ts').nestedRecordSchema>['choice']>) {
    const next = { ...record, name: 'a'.repeat(24), optional, choice, items: Array(16).fill(7) };
    assert.deepEqual(await session.command({ kind: 'putNested', record: next }), { kind: 'nested', record: next });
    assert.deepEqual(await session.command({ kind: 'getNested' }), { kind: 'nested', record: next });
  }
});

test('collection compiled sets folds templates polymorphism closures sized inputs and monads preserve state', async t => {
  const session = await app(t, collectionCodec, 'collection');
  await session.command({ kind: 'setItems', items: [0xffffffff, 2, 3] });
  await session.command({ kind: 'put', key: 'kept', value: 'yes' });
  assert.deepEqual(await session.command({ kind: 'set', add: 'a', remove: 'absent', has: 'a' }), { kind: 'set', size: 1, has: true });
  assert.deepEqual(await session.command({ kind: 'set', add: 'a', remove: 'absent', has: 'z' }), { kind: 'set', size: 1, has: false });
  assert.deepEqual(await session.command({ kind: 'set', add: 'b', remove: 'a', has: 'a' }), { kind: 'set', size: 1, has: false });
  assert.deepEqual(await session.command({ kind: 'fold' }), { kind: 'cell', value: 4 });
  assert.deepEqual(await session.command({ kind: 'transform', value: 0xffffffff, text: 'λ' }), { kind: 'transformed', values: [1,2,0xffffffff], text: 'λ' });
  assert.deepEqual(await session.command({ kind: 'consumeClosure', value: 1 }), { kind: 'missing' });
  await session.command({ kind: 'storeClosure', amount: 7 });
  await session.command({ kind: 'arraySet', index: 0xffffffff, value: 55 });
  assert.deepEqual(await session.command({ kind: 'sized' }), { kind: 'cell', value: 0xffffffff });
  assert.deepEqual(await session.command({ kind: 'consumeClosure', value: 3 }), { kind: 'cell', value: 10 });
  assert.deepEqual(await session.command({ kind: 'consumeClosure', value: 3 }), { kind: 'missing' });
  for (const [left, right, value] of [['40','2',42], ['x','2',null], ['40','x',null], ['x','x',null]] satisfies [string,string,number|null][]) {
    assert.deepEqual(await session.command({ kind: 'maybe', left, right }), { kind: 'maybe', value });
  }
  for (const [left,right,reply] of [
    ['40','2',{kind:'result',value:42}], ['x','x',{kind:'resultError',error:'left'}], ['40','x',{kind:'resultError',error:'right'}],
  ] satisfies [string,string,import('../../contracts/collection.ts').CollectionReply][]) assert.deepEqual(await session.command({kind:'result',left,right}),reply);
  assert.deepEqual(await session.command({kind:'arrayGet',index:3}),{kind:'cell',value:55});
  assert.deepEqual(await session.command({kind:'get',key:'kept'}),{kind:'text',text:'yes'});
  await session.command({kind:'setItems',items:[]});
  assert.deepEqual(await session.command({kind:'sort'}),{kind:'items',items:[]});
  assert.deepEqual(await session.command({kind:'fold'}),{kind:'cell',value:0});
  assert.deepEqual(await session.command({kind:'sized'}),{kind:'missing'});
  const empty = await session.command({kind:'capture'});
  if (empty.kind !== 'snapshot') throw new Error('snapshot');
  assert.deepEqual(await session.command({kind:'page',snapshot:empty.snapshot,offset:0,max:32}),{kind:'page',snapshot:empty.snapshot,offset:0,total:0,count:0,done:true,data:[]});
});

test('HTTP collection paging and feature state remain isolated across clients', async t => {
  const server = await gateway(t);
  const first = createAppClient(server.url), second = createAppClient(server.url);
  const a = await first.sessions.create({kind:'collection'}), b = await second.sessions.create({kind:'collection'});
  const command = (command: import('../../contracts/collection.ts').CollectionCommand) => first.collection.command({sessionId:a.sessionId,command});
  for (let i = 0; i < 3; i++) await command({kind:'appendItems',items:Array.from({length:32},(_,j)=>i*32+j)});
  await command({kind:'storeClosure',amount:5});
  assert.deepEqual(await second.collection.command({sessionId:b.sessionId,command:{kind:'consumeClosure',value:1}}),{kind:'missing'});
  const snapshot = await command({kind:'capture'});
  if(snapshot.kind!=='snapshot') throw new Error('snapshot');
  await command({kind:'mapInc'});
  const all:number[]=[];
  for(let offset=0;offset<96;offset+=32){
    const page=await second.collection.command({sessionId:a.sessionId,command:{kind:'page',snapshot:snapshot.snapshot,offset,max:32}});
    if(page.kind!=='page')throw new Error('page');all.push(...page.data);
  }
  assert.deepEqual(all,Array.from({length:96},(_,i)=>i));
  assert.deepEqual(await collectSnapshot({descriptor:snapshot,totalLimit:1024,pageCap:32,
    read:(offset,max)=>command({kind:'page',snapshot:snapshot.snapshot,offset,max})}),all);
  assert.deepEqual(await command({kind:'consumeClosure',value:2}),{kind:'cell',value:7});
  assert.deepEqual(await second.collection.command({sessionId:b.sessionId,command:{kind:'read'}}),{kind:'items',items:[]});
});

test('collection map put get del persist across requests', async t => {
  const session = await app(t, collectionCodec, 'collection');
  assert.deepEqual(await session.command({ kind: 'put', key: 'a', value: 'one' }), { kind: 'ok' });
  assert.deepEqual(await session.command({ kind: 'get', key: 'a' }), { kind: 'text', text: 'one' });
  assert.deepEqual(await session.command({ kind: 'get', key: 'a' }), { kind: 'text', text: 'one' });
  assert.deepEqual(await session.command({ kind: 'get', key: 'missing' }), { kind: 'missing' });
  assert.deepEqual(await session.command({ kind: 'del', key: 'a' }), { kind: 'deleted', text: 'one' });
  assert.deepEqual(await session.command({ kind: 'get', key: 'a' }), { kind: 'missing' });
});

test('collection list mapInc and sort persist affine array edits', async t => {
  const session = await app(t, collectionCodec, 'collection');
  assert.deepEqual(await session.command({ kind: 'setItems', items: [3, 1, 2] }), { kind: 'items', items: [3, 1, 2] });
  assert.deepEqual(await session.command({ kind: 'mapInc' }), { kind: 'items', items: [4, 2, 3] });
  assert.deepEqual(await session.command({ kind: 'sort' }), { kind: 'items', items: [2, 3, 4] });
  assert.deepEqual(await session.command({ kind: 'arraySet', index: 1, value: 9 }), { kind: 'ok' });
  assert.deepEqual(await session.command({ kind: 'arrayGet', index: 1 }), { kind: 'cell', value: 9 });
  assert.deepEqual(await session.command({ kind: 'read' }), { kind: 'items', items: [2, 3, 4] });
});

test('independent collection workers do not share maps', async t => {
  const first = await app(t, collectionCodec, 'collection');
  const second = await app(t, collectionCodec, 'collection');
  await first.command({ kind: 'put', key: 'k', value: 'v' });
  assert.deepEqual(await second.command({ kind: 'get', key: 'k' }), { kind: 'missing' });
});

test('native collection decoder rejects overlong, surrogate, and out-of-range UTF-8 without mutation', async t => {
  const session = await app(t, collectionCodec, 'collection');
  await session.command({ kind: 'put', key: 'k', value: 'kept' });
  for (const bytes of [
    [0xe0, 0x81, 0x81], [0xed, 0xa0, 0x80], [0xf0, 0x80, 0x81, 0x81], [0xf4, 0x90, 0x80, 0x80],
    [0xc0, 0x81], [0xe1, 0x80], [0x80],
  ]) {
    const payload = Buffer.from([0, 1, 107, bytes.length, ...bytes]);
    assert.deepEqual(collectionCodec.decode(await session.raw(payload)), { kind: 'invalidCommand' });
    assert.deepEqual(await session.command({ kind: 'get', key: 'k' }), { kind: 'text', text: 'kept' });
  }
  for (const text of ['\u07ff', '\u0800', '\ud7ff', '\ue000', '\uffff', '\u{10000}', '\u{10ffff}', '\ufeff']) {
    await session.command({ kind: 'put', key: 'k', value: text });
    assert.deepEqual(await session.command({ kind: 'get', key: 'k' }), { kind: 'text', text });
  }
});
