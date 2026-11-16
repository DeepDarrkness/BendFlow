import { relative, dirname, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { RECURSIVE_CLIENT_UNWRAP_KEYS } from '@orpc/client';

const [compiler, entry, policy = '{}'] = process.argv.slice(2);
const bounds = JSON.parse(policy);
const maxText = bounds.maxText ?? 96, maxItems = bounds.maxItems ?? 32;
const Bend = await import(pathToFileURL(compiler).href);
const book = Bend.book_nil(), seen = new Map(), modules = new Map();
const scalarKinds = new Map([['U32', 'u32'], ['Bool', 'bool'], ['Nat', 'nat'], ['F32', 'f32'], ['Unit', 'unit'], ['Char', 'char']]);
let nodes = 0;
function fail(path, reason) { throw new Error(`${path}: ${reason}`); }
function name(value, path) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value) || ['__proto__', 'prototype', 'constructor'].includes(value)) fail(path, `unsupported generated name ${value}`);
  return value;
}
function normal(term) { return Bend.term_wnf(book, term); }
function view(term) { return Bend.term_lower(normal(term)); }
function qualified(key) {
  const colon = key.lastIndexOf(':'), ns = colon < 0 ? '' : key.slice(0, colon), local = colon < 0 ? key : key.slice(colon + 1);
  return book.tlds[key]?.b ? local : `${modules.get(ns)}.${local}`;
}
function pairParts(term) {
  if (term.$ === 'App' && term.f.$ === 'App' && term.f.f.$ === 'Ref' && term.f.f.k === 'Pair') return [term.f.x, term.x];
  const t = normal(term);
  if (t.$ === 'ADT' && t.k === 'Sigma' && t.x.length === 4 && !t.r.length
    && view(t.x[0]).$ === 'Qua' && view(t.x[0]).q.$ === 'Lone' && view(t.x[1]).$ === 'Qua' && view(t.x[1]).q.$ === 'Lone') {
    return [t.x[2], normal(Bend.term_apply(t.x[3], Bend.Var('dependent_pair', 9999)))];
  }
  return null;
}
function code(term, path, depth = 0) {
  if (depth > 32) fail(path, 'closed type nesting exceeds 32');
  const parts = pairParts(term);
  if (parts) return `(${code(parts[0], path, depth + 1)} & ${code(parts[1], path, depth + 1)})`;
  const t = view(term);
  if (t.$ === 'Ref' || t.$ === 'ADT') {
    const colon = t.k.lastIndexOf(':'), ns = colon < 0 ? '' : t.k.slice(0, colon), local = colon < 0 ? t.k : t.k.slice(colon + 1);
    const definition = book.tlds[t.k];
    if (!definition) fail(path, 'unresolved type reference');
    const head = definition.b ? local : `${modules.get(ns)}.${local}`;
    if (t.$ === 'Ref') return head;
    if (t.r.length) fail(path, 'dependent/refined type is not Wire Data');
    return t.x.length ? `${head}<${normal(term).x.map(x => code(x, path, depth + 1)).join(', ')}>` : head;
  }
  if (t.$ === 'Qua' || t.$ === 'Lit') return Bend.term_show(t);
  fail(path, `${Bend.term_show(t)} requires a closed named type; dependent and function types are not Wire Data`);
}
function signature(key, arity) {
  const def = book.tlds[key];
  if (!def || def.$ !== 'Def' || def.m !== '' || def.v === null || def.i || def.x !== 0 || (arity !== undefined && def.n !== arity)) fail(key, `requires a filled entry-module definition${arity === undefined ? '' : ` with ${arity} parameters`} and no templates`);
  const parameters = [];
  let result = def.T;
  for (let index = 0; index < def.n; index++) {
    const t = normal(result);
    if (t.$ !== 'All' || !['Lone', 'Many'].includes(t.q.$)) fail(key, 'parameters must not be erased');
    parameters.push({ name: name(t.k, key), type: t.A, quantity: t.q.$ });
    result = t.B(Bend.Var(t.k, index));
  }
  return { parameters, result };
}
function io(term, path, required = true) {
  let t = term;
  for (let depth = 0; depth <= 32; depth++) {
    const [head, args] = Bend.term_unapply(Bend.term_strip(t));
    if (head.$ !== 'Ref') break;
    if (head.k === 'IO' && args.length === 1) return args[0];
    const definition = book.tlds[head.k];
    if (!definition || definition.$ !== 'Def' || definition.v === null || definition.x || definition.i || args.length !== definition.n) break;
    if (definition.u) fail(path, 'unsafe type aliases are unsupported');
    if (depth === 32) fail(path, 'IO alias unfolding exceeds depth32 or is recursive');
    t = args.reduce((body, argument) => Bend.term_apply(body, argument), definition.v);
  }
  if (required) fail(path, 'requires an IO result');
  return null;
}
function fields(term, count, path, active, depth) {
  let rest = term;
  const result = [];
  for (let i = 0; i < count; i++) {
    const t = normal(rest);
    if (t.$ !== 'All' || t.q.$ === 'None') fail(path, 'erased fields/proofs are unsupported; keep them inside helpers or state');
    const field = name(t.k, path);
    if (result.some(x => x.name === field)) fail(path, 'duplicate field name');
    result.push({ name: field, value: expand(t.A, `${path}.${field}`, active, depth + 1) });
    rest = t.B(Bend.Var(t.k, i + 100));
  }
  const end = view(rest);
  if (end.$ !== 'ADT' || end.r.length) fail(path, 'dependent constructor result is unsupported');
  return result;
}
function declarationCycle(key, path, stack = []) {
  if (stack.length > 32) fail(path, 'datatype dependency nesting exceeds 32');
  if (stack.includes(key)) fail(path, `${key} has a recursive datatype declaration; use a bounded List instead`);
  const declaration = book.tlds[key];
  if (!declaration || declaration.$ !== 'ADT' || declaration.b) return;
  const references = new Set();
  function collect(value) {
    if (!value || typeof value !== 'object') return;
    if ((value.$ === 'Ref' || value.$ === 'ADT') && book.tlds[value.k]?.$ === 'ADT' && !book.tlds[value.k].b) references.add(value.k);
    for (const child of Object.entries(value)) if (child[0] !== 's') {
      if (Array.isArray(child[1])) child[1].forEach(collect);
      else collect(child[1]);
    }
  }
  for (const ctor of declaration.c) {
    let telescope = ctor.T;
    for (let i = 0; i < declaration.n; i++) { const head = normal(telescope); telescope = head.B(Bend.Var(head.k, i)); }
    for (let i = 0; i < ctor.n; i++) {
      const head = normal(telescope);
      collect(Bend.term_lower(head.A));
      telescope = head.B(Bend.Var(head.k, declaration.n + i));
    }
  }
  for (const reference of references) declarationCycle(reference, path, [...stack, key]);
}
function expand(term, path, active = [], depth = 0) {
  if (depth > 32 || ++nodes > 4096) fail(path, 'Wire Data expansion exceeds depth32/node4096 limit');
  const parts = pairParts(term);
  if (parts) return { kind: 'pair', left: expand(parts[0], `${path}[0]`, active, depth + 1), right: expand(parts[1], `${path}[1]`, active, depth + 1) };
  const t = normal(term), v = Bend.term_lower(t);
  const key = v.$ === 'Ref' || v.$ === 'ADT' ? v.k : null;
  const scalar = scalarKinds.get(key);
  if (scalar) return { kind: scalar };
  if (key === 'String') return { kind: 'string', maxBytes: maxText };
  if (key === 'List' && t.$ === 'ADT' && t.x.length === 2 && !t.r.length) {
    if (view(t.x[0]).$ !== 'Qua' || view(t.x[0]).q.$ !== 'Many') fail(path, 'external lists must be List<&2, Data>');
    return { kind: 'list', bendType: code(t, path), maxItems, element: expand(t.x[1], `${path}[]`, active, depth + 1) };
  }
  const adt = key && book.tlds[key];
  if (!adt || adt.$ !== 'ADT' || t.$ !== 'ADT' || t.r.length || t.x.length !== adt.n) fail(path, `${Bend.term_show(v)} requires a concrete named type; dependent and function types are not Wire Data`);
  const kind = view(Bend.tele_fill(book, adt.T, t.x, Bend.ctx_nil()));
  if (kind.$ !== 'Typ' || kind.g.$ !== 'Qua' || kind.g.q.$ !== 'Many') fail(path, `${key} must be declared is Data, not Type; keep handles in lifecycle state`);
  if (adt.b) fail(path, `${key} is not supported Wire Data; expose supported scalars/records instead`);
  const application = code(t, path);
  declarationCycle(key, path);
  if (active.includes(application)) fail(path, `${application} is recursive business Data; use a bounded List instead`);
  const cases = adt.c.map(ctr => {
    const caseName = name(ctr.k.split(':').at(-1).split('.').at(-1), path);
    return { name: caseName, constructor: qualified(ctr.k), fields: fields(Bend.tele_fill(book, ctr.T, t.x, Bend.ctx_nil()), ctr.n,
      adt.c.length > 1 ? `${path}.cases.${caseName}` : path, [...active, application], depth) };
  });
  if (!cases.length || cases.length > 256) fail(path, 'requires 1 through 256 constructors');
  if (new Set(cases.map(value => value.name)).size !== cases.length) fail(path, 'constructor names collide in the external union; use distinct suffixes');
  if (cases.length === 1) return { kind: 'record', bendType: application, constructor: cases[0].constructor, fields: cases[0].fields };
  return { kind: 'union', bendType: application, cases };
}
try {
  if (!Number.isInteger(maxText) || maxText < 0 || maxText > 247 || !Number.isInteger(maxItems) || maxItems < 0 || maxItems > 255) fail(entry, 'bounds must be integer text0..247/list0..255');
  await Bend.book_load(book, entry, '', seen);
  Bend.book_valid(book);
  if (book.hols) fail(entry, 'incomplete definitions or unresolved holes');
  const sources = [...seen.keys()].filter(file => file !== Bend.BASE_BEND).sort();
  const imports = [];
  modules.set('', 'Entry');
  for (const file of sources) {
    const path = relative(dirname(entry), file);
    if (isAbsolute(path) || path === '..' || path.startsWith('../')) fail(file, 'imports must stay within the entry directory');
    const ns = seen.get(file);
    if (ns) { const alias = `WireModule${imports.length}`; modules.set(ns, alias); imports.push({ alias, path }); }
  }
  const exports = book.order.filter(key => key.startsWith('api.') && book.tlds[key]?.m === '').sort();
  if (!exports.length) fail(entry, 'no entry-module api.* services');
  const services = exports.map(key => {
    const suffix = name(key.slice(4), key);
    if (suffix === 'sessions' || RECURSIVE_CLIENT_UNWRAP_KEYS.has(suffix)) fail(key, `reserved endpoint name ${suffix}`);
    const init = `lifecycle.init.${suffix}`, finalize = `lifecycle.finalize.${suffix}`, transition = signature(key);
    let external = transition.parameters, reply = transition.result, category;
    if (book.tlds[init] || book.tlds[finalize]) {
      const initialized = signature(init, 0), closed = signature(finalize, 1);
      const state = io(initialized.result, init), paired = pairParts(io(reply, key));
      if (!external.length || !paired) fail(key, 'requires IO(State & Response) and a first state parameter');
      if (external[0].quantity !== 'Lone') fail(key, 'transition state parameter must be affine');
      if (closed.parameters[0].quantity !== 'Lone') fail(finalize, 'finalizer state parameter must be affine');
      const stateCode = code(state, init);
      if ([external[0].type, paired[0], closed.parameters[0].type].some(x => code(x, key) !== stateCode)) fail(key, 'initializer, transition, and finalizer must use the same state type');
      if (code(io(closed.result, finalize), finalize) !== 'Unit') fail(finalize, 'requires IO(Unit)');
      category = { kind: 'stateful', state: Bend.term_show(Bend.term_lower(state)), stateCode, initialize: init, finalize };
      external = external.slice(1); reply = paired[1];
    } else {
      const wrapped = io(reply, key, false);
      category = { kind: wrapped ? 'io' : 'pure' }; reply = wrapped ?? reply;
    }
    return { ...category, name: suffix, call: key, args: external.map(x => ({ name: x.name, value: expand(x.type, `${key}.args.${x.name}`) })), reply: expand(reply, `${key}.result`) };
  });
  for (const key of book.order) {
    if (book.tlds[key]?.m === '' && /^lifecycle\.(init|finalize)\./.test(key) && !services.some(s => key === s.initialize || key === s.finalize)) fail(key, 'orphan lifecycle declaration has no exported service');
    if (!book.tlds[key]?.b && book.tlds[key]?.i) fail(key, 'foreign effects are not supported by this build');
  }
  process.stdout.write(JSON.stringify({ services, sources, imports }));
} catch (error) {
  process.stderr.write((error?.$ === 'Err' ? Bend.err_show(error) : error.message ?? String(error)) + '\n');
  process.exitCode = 1;
}
