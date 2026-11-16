import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectServices } from '../../scripts/services/inspect.ts';
import { projectPath } from '../../src/paths.ts';
import { check } from '../support/compiler.ts';
import { contractId, emitContracts } from '../../scripts/services/emit.ts';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

test('service generator derives external Data fields and authorizes private state through the lifecycle pair', () => {
  const description = inspectServices(projectPath('examples/services/counter.bend'));
  assert.deepEqual(description.services.map(service => {
    const arg = service.args[0];
    if (!arg || arg.value.kind !== 'record' || service.reply.kind !== 'record') throw new Error('Expected record boundary');
    return { name: service.name, parameter: arg.name, request: arg.value.fields.map(field => field.name), response: service.reply.fields.map(field => field.name) };
  }), [
    { name: 'accumulate', parameter: 'sample', request: ['delta', 'weight'], response: ['running', 'calls'] },
    { name: 'counter', parameter: 'request', request: ['amount'], response: ['value'] },
  ]);
  const counter = description.services[1];
  assert.ok(counter?.kind === 'stateful');
  assert.equal(counter.state, 'CounterState');
});

for (const [fixture, diagnostic] of [
  ['not-data', /api\.bad\.args\.request: Request must be declared is Data, not Type/],
  ['unsupported-data', /api\.bad\.args\.request\.amount: Cmp is not supported Wire Data/],
  ['dependent', /api\.bad\.args\.request: .*requires a concrete named type; dependent and function types/],
  ['missing-lifecycle', /lifecycle\.finalize\.bad: requires a filled entry-module definition/],
] satisfies [string, RegExp][]) {
  test(`service generator rejects compiler-valid ${fixture} before endpoint emission`, async () => {
    const path = `tests/fixtures/services/${fixture}.bend`;
    const result = await check(path);
    assert.equal(result.stderr, '');
    assert.throws(() => inspectServices(projectPath(path)), diagnostic);
  });
}

test('closed generic internal state and internal datatype names do not change the external wire contract', async () => {
  await check('tests/fixtures/services/generic-state.bend');
  const generic = inspectServices(projectPath('tests/fixtures/services/generic-state.bend')).services[0];
  const plain = inspectServices(projectPath('examples/services/counter.bend')).services.find(service => service.name === 'counter');
  if (!generic || !plain) throw new Error('Expected counter services');
   assert.ok(generic.kind === 'stateful');
   assert.equal(generic.state, 'State<U32>');
  assert.equal(contractId(generic), contractId(plain));
  assert.equal(emitContracts([generic], './sessions.ts'), emitContracts([plain], './sessions.ts'));
});

test('service names reserved by the installed recursive client fail generation', t => {
  const root = mkdtempSync(projectPath('build/reserved-service-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const name of ['bind', 'toString', 'valueOf', 'toJSON']) {
    const entry = resolve(root, 'services.bend');
    writeFileSync(entry, `import Base
type State is Type:
  State{value: U32}
type Request is Data:
  Request{amount: U32}
type Reply is Data:
  Reply{value: U32}
def lifecycle.init.${name}() -> IO(State):
  IO.pure(State, State{0})
def lifecycle.finalize.${name}(state: State) -> IO(Unit):
  IO.pure(Unit, Unit{})
def api.${name}(state: State, request: Request) -> IO(State & Reply):
  IO.pure(State & Reply, (state, Reply{0}))
`);
    assert.throws(() => inspectServices(entry), new RegExp(`api\\.${name}: reserved endpoint name`));
  }
});
