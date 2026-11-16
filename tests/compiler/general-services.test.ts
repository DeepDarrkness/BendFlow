import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { inspectServices } from '../../scripts/services/inspect.ts';
import { contractId } from '../../scripts/services/emit.ts';
import { projectPath } from '../../src/paths.ts';
import { analyzeWire, maxJsonBytes, maxServiceBodyBytes } from '../../scripts/services/wire.ts';

test('recursive IR expands closed imported generic Data and keeps only entry exports', () => {
  const {services} = inspectServices(projectPath('examples/services/portable.bend'),{maxText:16,maxItems:4});
  assert.ok(!services.some(service => service.name === 'hidden'));
  assert.equal(services.find(service => service.name === 'add')?.args.length,2);
  assert.equal(services.find(service => service.name === 'answer')?.args.length,0);
  assert.equal(services.find(service => service.name === 'greet')?.kind,'io');
  assert.equal(services.find(service => service.name === 'store')?.kind,'stateful');
  const packet = services.find(service => service.name === 'packet');
  assert.ok(packet && packet.reply.kind === 'record');
  const box = packet.reply.fields.find(field => field.name === 'box');
  assert.ok(box?.value.kind === 'record');
  assert.equal(box.value.fields[0]?.value.kind,'record');
  assert.ok(analyzeWire(packet.reply).maxBytes < 248);
  assert.throws(() => inspectServices(projectPath('examples/services/portable.bend')),/worst-case.*exceeds 248/);
});

test('compiler-valid unsupported boundaries and lifecycles fail with actionable nested paths', t => {
  const root = mkdtempSync(projectPath('build/general-negatives-'));
  t.after(() => rmSync(root,{recursive:true,force:true}));
  const fixtures: readonly [string,string,RegExp][] = [
    ['direct','type Tree is Data:\n  Leaf{}\n  Branch{tree: Tree}\ndef api.bad(value: Tree) -> U32:\n  0',/api.bad.args.value.*recursive/],
    ['mutual','type A is Data:\n  A{b: B}\ntype B is Data:\n  B{a: A}\ndef api.bad(value: A) -> U32:\n  0',/api.bad.args.value.*recursive/],
    ['expanding','type Grow<-A: Data> is Data:\n  Grow{next: Grow<List<&2, A>>}\ndef api.bad(value: Grow<U32>) -> U32:\n  0',/api.bad.args.value.*recursive/],
    ['function','def api.bad(value: U32 -> U32) -> U32:\n  value(0)',/api.bad.args.value.*function types/],
    ['proof','type Proof is Data:\n  Proof{-e: {0n == 0n : Nat}}\ndef api.bad(value: Proof) -> U32:\n  0',/api.bad.args.value.*erased fields\/proofs/],
    ['handle','def api.bad(value: File) -> U32:\n  0',/api.bad.args.value.*concrete named type/],
    ['nested','type Inside is Data:\n  Inside{bad: Char}\ntype Outer is Data:\n  Outer{nested: Inside}\ndef api.bad(value: Outer) -> U32:\n  0',/api.bad.args.value.nested.bad.*not supported/],
    ['orphan','def lifecycle.init.bad() -> IO(Unit):\n  IO.pure(Unit, Unit{})\ndef api.ok() -> U32:\n  0',/orphan lifecycle/],
    ['incomplete','def lifecycle.init.bad() -> IO(Unit):\n  IO.pure(Unit, Unit{})\ndef api.bad() -> U32:\n  0',/lifecycle.finalize.bad.*filled entry-module/],
    ['reply-function','def api.bad() -> U32 -> U32:\n  x => x',/api.bad.result.*function types/],
    ['unsafe-alias','@unsafe def Reply() -> Type:\n  IO(U32)\ndef api.bad() -> Reply():\n  IO.pure(U32, 42)',/api.bad.*unsafe type aliases/],
  ];
  for (const [name,body,diagnostic] of fixtures) {
    const entry = resolve(root,`${name}.bend`);
    writeFileSync(entry,`import Base\n${body}\n`);
    assert.throws(() => inspectServices(entry),diagnostic,name);
  }
});

test('nested pair state remains grouped and closed IO aliases retain their service category', () => {
  const pair = inspectServices(projectPath('tests/fixtures/services/pair-state.bend')).services[0];
  assert.ok(pair?.kind === 'stateful');
  assert.equal(pair.stateCode, '((U32 & Bool) & Unit)');
  const aliases = inspectServices(projectPath('tests/fixtures/services/io-alias.bend')).services;
  assert.deepEqual(aliases.map(({name,kind,reply}) => [name,kind,reply.kind]), [['answer','io','u32'],['generic','io','u32'],['nested','io','u32'],['state','stateful','u32']]);
});

test('HTTP body limits account for escaped envelopes and zero-width native records', () => {
  const service = inspectServices(projectPath('tests/fixtures/services/unit-markers.bend')).services[0];
  assert.ok(service);
  const argument = service.args[0];
  assert.ok(argument);
  assert.equal(analyzeWire(argument.value).maxBytes,1);
  assert.equal(maxServiceBodyBytes(service),7602);
  assert.equal(maxJsonBytes({kind:'string',maxBytes:96}),578);
  assert.equal(maxJsonBytes({kind:'nat'}),92);
  assert.equal(maxJsonBytes({kind:'f32'}),39);
  assert.equal(maxJsonBytes({kind:'pair',left:{kind:'u32'},right:{kind:'bool'}}),18);
  assert.equal(maxJsonBytes({kind:'union',bendType:'Choice',cases:[{name:'EscapedCase',constructor:'Choice.EscapedCase',fields:[{name:'x',value:{kind:'unit'}}]}]}),152);
});

test('canonical contracts ignore native record spelling and category but retain external order and resolved bounds', () => {
  const service = inspectServices(projectPath('examples/services/portable.bend'),{maxText:16,maxItems:4}).services.find(service => service.name === 'packet');
  assert.ok(service && service.reply.kind === 'record');
  const renamed = {...service,reply:{...service.reply,bendType:'Other.Name',constructor:'Other.Ctor'}};
  assert.equal(contractId(service),contractId(renamed));
  assert.notEqual(contractId(service),contractId({...service,reply:{...service.reply,fields:[...service.reply.fields].reverse()}}));
  const greeting = inspectServices(projectPath('examples/services/portable.bend'),{maxText:15,maxItems:4}).services.find(service => service.name === 'greet');
  const other = inspectServices(projectPath('examples/services/portable.bend'),{maxText:16,maxItems:4}).services.find(service => service.name === 'greet');
  assert.ok(greeting && other);
  assert.notEqual(contractId(greeting),contractId(other));
  assert.equal(contractId(other),contractId({...other,kind:'pure'}));
});
