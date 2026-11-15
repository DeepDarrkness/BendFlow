import assert from 'node:assert/strict';
import test from 'node:test';
import { collectionCodec } from '../../src/protocol/codecs/collection.ts';
import { fileCodec } from '../../src/protocol/codecs/file.ts';
import { BytesWriter } from '../../src/protocol/bytes.ts';
import { COLLECTION_ENCODED_COMMAND_BOUNDS, COLLECTION_ENCODED_REPLY_BOUNDS, type CollectionCommand, type CollectionReply } from '../../contracts/collection.ts';
import { FILE_ENCODED_COMMAND_BOUNDS, FILE_ENCODED_REPLY_BOUNDS, type FileCommand, type FileReply } from '../../contracts/file.ts';
import { collectSnapshot } from '../../contracts/pages.ts';
import { app } from '../support/native.ts';

test('native collection array contents encode all retained cells without consuming the array',async t=>{
  const session=await app(t,collectionCodec,'collection');
  for(let index=0;index<4;index++)await session.command({kind:'arraySet',index,value:10+index});
  const expected=new BytesWriter().u8(5).u32s([10,11,12,13]).toBuffer();
  assert.deepEqual(await session.raw(Buffer.from([23])),expected);
  assert.deepEqual(await session.command({kind:'arrayRead'}),{kind:'items',items:[10,11,12,13]});
  await session.command({kind:'arraySet',index:7,value:99});
  assert.deepEqual(await session.command({kind:'arrayRead'}),{kind:'items',items:[10,11,12,99]});
  for(const raw of [Buffer.alloc(0),Buffer.from([23,0])])assert.deepEqual(collectionCodec.decode(await session.raw(raw)),{kind:'invalidCommand'});
  assert.deepEqual(await session.command({kind:'arrayGet',index:3}),{kind:'cell',value:99});
});

test('snapshot collector rejects mixed identities totals offsets stale and truncated completion',async()=>{
  const first={kind:'page',snapshot:1,offset:0,total:3,count:2,done:false,data:[1,2]};
  for(const last of [
    {kind:'page',snapshot:2,offset:2,total:3,count:1,done:true,data:[3]},
    {kind:'page',snapshot:1,offset:2,total:4,count:2,done:true,data:[3,4]},
    {kind:'page',snapshot:1,offset:1,total:3,count:2,done:true,data:[2,3]},
    {kind:'page',snapshot:1,offset:2,total:3,count:0,done:true,data:[]},{kind:'stale'},
  ]){
    let calls=0;
    await assert.rejects(collectSnapshot({descriptor:{kind:'snapshot',snapshot:1,total:3},totalLimit:1024,pageCap:2,
      read:async()=>calls++===0?first:last}));
    assert.equal(calls,2);
  }
  let dispatched=false;
  await assert.rejects(collectSnapshot({descriptor:{kind:'snapshot',snapshot:1,total:1025},totalLimit:1024,pageCap:32,
    read:async()=>{dispatched=true;return first;}}));assert.equal(dispatched,false);
});

test('collection and file golden paging vectors use U32 descriptors and consistent counts', () => {
  assert.equal(collectionCodec.encode({kind:'page',snapshot:1,offset:32,max:32}).toString('hex'),'0b000000010000002000000020');
  assert.equal(fileCodec.encode({kind:'page',snapshot:0xffffffff,offset:192,max:192}).toString('hex'),'08ffffffff000000c0000000c0');
  for(const codec of [collectionCodec,fileCodec]){
    assert.deepEqual(codec.decode(Buffer.from('060000000100000020','hex')),{kind:'snapshot',snapshot:1,total:32});
    assert.deepEqual(codec.decode(Buffer.from([8])),{kind:'stale'});
    assert.deepEqual(codec.decode(Buffer.from([9])),{kind:'invalidOffset'});
    assert.deepEqual(codec.decode(Buffer.from([10])),{kind:'limit'});
    assert.deepEqual(codec.decode(Buffer.from([11])),{kind:'exhausted'});
  }
  assert.deepEqual(collectionCodec.decode(Buffer.from('0700000001000000000000000200000002010200000000000000ff','hex')),
    {kind:'page',snapshot:1,offset:0,total:2,count:2,done:true,data:[0,255]});
  assert.deepEqual(fileCodec.decode(Buffer.from('0700000001000000000000000300000003010300ff80','hex')),
    {kind:'page',snapshot:1,offset:0,total:3,count:3,done:true,data:Buffer.from([0,255,128])});
});

test('collection and file every command has an explicit golden byte vector',()=>{
  const collection:[CollectionCommand,string][]=[
    [{kind:'put',key:'k',value:'v'},'00016b0176'],[{kind:'get',key:'k'},'01016b'],[{kind:'del',key:'k'},'02016b'],
    [{kind:'setItems',items:[1,2]},'03020000000100000002'],[{kind:'mapInc'},'04'],[{kind:'sort'},'05'],
    [{kind:'arraySet',index:1,value:2},'060000000100000002'],[{kind:'arrayGet',index:1},'0700000001'],[{kind:'read'},'08'],
    [{kind:'appendItems',items:[3]},'090100000003'],[{kind:'capture'},'0a'],[{kind:'page',snapshot:1,offset:2,max:3},'0b000000010000000200000003'],
    [{kind:'release',snapshot:1},'0c00000001'],[{kind:'putNested',record:{name:'n',point:[1,2],optional:3,choice:{kind:'number',value:4},items:[5]}},'0d016e000700000001000000020000000100000003000000000000000400000005'],
    [{kind:'getNested'},'0e'],[{kind:'set',add:'a',remove:'b',has:'a'},'0f016101620161'],[{kind:'fold'},'10'],
    [{kind:'transform',value:5,text:'x'},'11000000050178'],[{kind:'storeClosure',amount:5},'1200000005'],
    [{kind:'consumeClosure',value:5},'1300000005'],[{kind:'sized'},'14'],[{kind:'maybe',left:'1',right:'2'},'1501310132'],[{kind:'result',left:'1',right:'2'},'1601310132'],
    [{kind:'arrayRead'},'17'],
  ];
  assert.equal(collection.length,Object.keys(COLLECTION_ENCODED_COMMAND_BOUNDS).length);
  for(const [command,hex]of collection)assert.equal(collectionCodec.encode(command).toString('hex'),hex);
  const file:[FileCommand,string][]=[
    [{kind:'open',path:'p',mode:'r'},'0001700172'],[{kind:'write',id:1,bytes:Buffer.from([0,255])},'01000000010200ff'],
    [{kind:'read',id:1,max:192},'0200000001000000c0'],[{kind:'size',id:1},'0300000001'],
    [{kind:'readAt',id:1,offset:2,max:3},'04000000010000000200000003'],[{kind:'writeAt',id:1,offset:2,bytes:Buffer.from([128])},'0500000001000000020180'],
    [{kind:'close',id:1},'0600000001'],[{kind:'capture',id:1},'0700000001'],[{kind:'page',snapshot:1,offset:2,max:3},'08000000010000000200000003'],[{kind:'release',snapshot:1},'0900000001'],
  ];
  assert.equal(file.length,Object.keys(FILE_ENCODED_COMMAND_BOUNDS).length);
  for(const [command,hex]of file)assert.equal(fileCodec.encode(command).toString('hex'),hex);
});

test('collection and file every reply variant has an explicit golden byte vector',()=>{
  const collection:[string,CollectionReply][]=[['00',{kind:'ok'}],['010178',{kind:'text',text:'x'}],['02',{kind:'missing'}],
    ['030178',{kind:'deleted',text:'x'}],['0400000001',{kind:'cell',value:1}],['05020000000100000002',{kind:'items',items:[1,2]}],
    ['ff',{kind:'invalidCommand'}],['060000000100000000',{kind:'snapshot',snapshot:1,total:0}],
    ['07000000010000000000000000000000000100',{kind:'page',snapshot:1,offset:0,total:0,count:0,done:true,data:[]}],
    ['08',{kind:'stale'}],['09',{kind:'invalidOffset'}],['0a',{kind:'limit'}],['0b',{kind:'exhausted'}],
    ['0c016e000700000001000000020000000100000003000000000000000400000005',{kind:'nested',record:{name:'n',point:[1,2],optional:3,choice:{kind:'number',value:4},items:[5]}}],
    ['0d0000000101',{kind:'set',size:1,has:true}],['0e0000000100000002000000030178',{kind:'transformed',values:[1,2,3],text:'x'}],
    ['0f00',{kind:'maybe',value:null}],['0f0100000001',{kind:'maybe',value:1}],['1000000001',{kind:'result',value:1}],
    ['1100',{kind:'resultError',error:'left'}],['1101',{kind:'resultError',error:'right'}],
  ];
  assert.deepEqual([...new Set(collection.map(([,r])=>r.kind))].toSorted(),Object.keys(COLLECTION_ENCODED_REPLY_BOUNDS).toSorted());
  for(const [hex,reply]of collection){assert.deepEqual(collectionCodec.decode(Buffer.from(hex,'hex')),reply);assert.throws(()=>collectionCodec.decode(Buffer.from(hex+'00','hex')));}
  const file:[string,FileReply][]=[['00',{kind:'ok'}],['0000000001',{kind:'opened',id:1}],['010200ff',{kind:'bytes',bytes:Buffer.from([0,255])}],
    ['02000000010178',{kind:'fail',code:1,message:'x'}],['03',{kind:'missing'}],['0400000001',{kind:'size',value:1}],['ff',{kind:'invalidCommand'}],
    ['060000000100000000',{kind:'snapshot',snapshot:1,total:0}],['07000000010000000000000000000000000100',{kind:'page',snapshot:1,offset:0,total:0,count:0,done:true,data:Buffer.alloc(0)}],
    ['08',{kind:'stale'}],['09',{kind:'invalidOffset'}],['0a',{kind:'limit'}],['0b',{kind:'exhausted'}],
  ];
  assert.deepEqual(file.map(([,r])=>r.kind).toSorted(),Object.keys(FILE_ENCODED_REPLY_BOUNDS).toSorted());
  for(const [hex,reply]of file){assert.deepEqual(fileCodec.decode(Buffer.from(hex,'hex')),reply);assert.throws(()=>fileCodec.decode(Buffer.from(hex+'00','hex')));}
});

test('collection and file complete encoded bounds include nested and page overhead',()=>{
  const text='a'.repeat(96),short='a'.repeat(24),items=Array(32).fill(0xffffffff),bytes=Buffer.alloc(192,255);
  const commands:CollectionCommand[]=[
    {kind:'put',key:text,value:text},{kind:'get',key:text},{kind:'del',key:text},{kind:'setItems',items},
    {kind:'mapInc'},{kind:'sort'},{kind:'arraySet',index:0xffffffff,value:0xffffffff},{kind:'arrayGet',index:0xffffffff},{kind:'read'},
    {kind:'appendItems',items},{kind:'capture'},{kind:'page',snapshot:0xffffffff,offset:0xffffffff,max:32},{kind:'release',snapshot:0xffffffff},
    {kind:'putNested',record:{name:short,point:[0xffffffff,0xffffffff],optional:0xffffffff,choice:{kind:'text',text:short},items:Array(16).fill(0xffffffff)}},
    {kind:'getNested'},{kind:'set',add:short,remove:short,has:short},{kind:'fold'},{kind:'transform',value:0xffffffff,text:short},
    {kind:'storeClosure',amount:0xffffffff},{kind:'consumeClosure',value:0xffffffff},{kind:'sized'},{kind:'maybe',left:short,right:short},{kind:'result',left:short,right:short},
    {kind:'arrayRead'},
  ];
  assert.deepEqual(commands.map(c=>c.kind).toSorted(),Object.keys(COLLECTION_ENCODED_COMMAND_BOUNDS).toSorted());
  for(const command of commands)assert.equal(collectionCodec.encode(command).length,COLLECTION_ENCODED_COMMAND_BOUNDS[command.kind]);
  const files:FileCommand[]=[{kind:'open',path:text,mode:'r+'},{kind:'write',id:1,bytes},{kind:'read',id:1,max:192},{kind:'size',id:1},
    {kind:'readAt',id:1,offset:0xffffffff,max:192},{kind:'writeAt',id:1,offset:0xffffffff,bytes},{kind:'close',id:1},{kind:'capture',id:1},
    {kind:'page',snapshot:1,offset:0xffffffff,max:192},{kind:'release',snapshot:1}];
  assert.deepEqual(files.map(c=>c.kind).toSorted(),Object.keys(FILE_ENCODED_COMMAND_BOUNDS).toSorted());
  for(const command of files)assert.equal(fileCodec.encode(command).length,FILE_ENCODED_COMMAND_BOUNDS[command.kind]);
  for(const bound of [...Object.values(COLLECTION_ENCODED_REPLY_BOUNDS),...Object.values(FILE_ENCODED_REPLY_BOUNDS)])assert.ok(bound<=248);
  const collectionPage=new BytesWriter().u8(7).u32(1).u32(0).u32(32).u32(32).u8(1).u32s(items).toBuffer();
  const filePage=new BytesWriter().u8(7).u32(1).u32(0).u32(192).u32(192).u8(1).bytes(bytes).toBuffer();
  assert.equal(collectionPage.length,COLLECTION_ENCODED_REPLY_BOUNDS.page);assert.equal(filePage.length,FILE_ENCODED_REPLY_BOUNDS.page);
  collectionCodec.decode(collectionPage);fileCodec.decode(filePage);
  assert.throws(()=>collectionCodec.parse({kind:'appendItems',items:Array(33).fill(0)}));
  assert.throws(()=>fileCodec.parse({kind:'write',id:1,bytes:Buffer.alloc(193)}));
  assert.throws(()=>collectionCodec.parse({kind:'putNested',record:{name:short+'x',point:[0,0],optional:null,choice:{kind:'number',value:0},items:[]}}));
});

test('collection and file reject truncated trailing unknown and inconsistent page replies',()=>{
  const collection=new BytesWriter().u8(7).u32(1).u32(0).u32(2).u32(2).u8(1).u32s([1,2]).toBuffer();
  const file=new BytesWriter().u8(7).u32(1).u32(0).u32(2).u32(2).u8(1).bytes(Buffer.from([1,2])).toBuffer();
  for(const [codec,valid] of [[collectionCodec,collection],[fileCodec,file]] satisfies [typeof collectionCodec|typeof fileCodec,Buffer][]){
    for(let i=0;i<valid.length;i++)assert.throws(()=>codec.decode(valid.subarray(0,i)));
    assert.throws(()=>codec.decode(Buffer.concat([valid,Buffer.from([0])])));
    assert.throws(()=>codec.decode(Buffer.from([254])));
    for(const [offset,value] of [[1,0],[5,3],[9,1],[13,1]] satisfies [number,number][]){
      const raw=Buffer.from(valid);raw.writeUInt32BE(value,offset);assert.throws(()=>codec.decode(raw));
    }
    const flag=Buffer.from(valid);flag[17]=2;assert.throws(()=>codec.decode(flag));
    const unfinished=Buffer.from(valid);unfinished[17]=0;assert.throws(()=>codec.decode(unfinished));
    assert.throws(()=>codec.decode(Buffer.from('060000000000000000','hex')));
  }
  for(const [codec,max,total] of [[collectionCodec,32,1024],[fileCodec,192,65536]] satisfies [typeof collectionCodec|typeof fileCodec,number,number][]){
    assert.throws(()=>codec.parse({kind:'page',snapshot:0,offset:0,max}));
    assert.throws(()=>codec.parse({kind:'page',snapshot:1,offset:0,max:0}));
    assert.throws(()=>codec.parse({kind:'page',snapshot:1,offset:0,max:max+1}));
    assert.throws(()=>codec.decode(new BytesWriter().u8(6).u32(1).u32(total+1).toBuffer()));
  }
  for(const invalid of [Buffer.from([1,1,128]),Buffer.from([12,1,128])])assert.throws(()=>collectionCodec.decode(invalid));
});
