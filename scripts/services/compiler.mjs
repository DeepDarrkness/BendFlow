import { relative, dirname, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { RECURSIVE_CLIENT_UNWRAP_KEYS } from '@orpc/client';

const [compiler, entry] = process.argv.slice(2);
const Bend = await import(pathToFileURL(compiler).href);
const book = Bend.book_nil();
const seen = new Map();

function fail(path, reason) {
  throw new Error(`${path}: ${reason}`);
}

function name(value, path) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value) || ['__proto__', 'prototype', 'constructor'].includes(value)) {
    fail(path, `unsupported generated name ${value}`);
  }
  return value;
}

function lowered(type) {
  return Bend.term_lower(type);
}

function signature(key, arity) {
  const def = book.tlds[key];
  if (!def || def.$ !== 'Def' || def.m !== '' || def.v === null || def.i || def.x !== 0 || def.n !== arity) {
    fail(key, `requires a filled entry-module definition with ${arity} parameters and no templates`);
  }
  const parameters = [];
  let result = lowered(def.T);
  for (let index = 0; index < arity; index++) {
    if (result.$ !== 'All' || result.q.$ !== 'Lone') fail(key, 'parameters must be affine and not erased');
    parameters.push({ name: result.k, type: result.A });
    result = result.B;
  }
  return { parameters, result };
}

function ref(term, path) {
  if (term.$ !== 'Ref') fail(path, 'requires a concrete named type; dependent and function types are not Wire Data');
  return term.k;
}

function io(term, path) {
  if (term.$ !== 'App' || term.f.$ !== 'Ref' || term.f.k !== 'IO') fail(path, 'requires an IO result');
  return term.x;
}

function pair(term, path) {
  if (term.$ !== 'App' || term.f.$ !== 'App' || term.f.f.$ !== 'Ref' || term.f.f.k !== 'Pair') {
    fail(path, 'requires IO(State & Response)');
  }
  return [term.f.x, term.x];
}

function stateType(term, path) {
  const key = term.$ === 'Ref' || term.$ === 'ADT' ? term.k : null;
  const definition = key && book.tlds[key];
  const arguments_ = term.$ === 'ADT' ? term.x : [];
  if (!definition || definition.$ !== 'ADT' || definition.b || key.includes(':') || definition.n !== arguments_.length) {
    fail(path, 'requires a concrete local state datatype, optionally with closed type arguments');
  }
  function code(type, depth = 0) {
    if (depth > 32) fail(path, 'state type argument nesting exceeds the slice limit');
    if (type.$ === 'Ref' || type.$ === 'ADT') {
      if (type.k.includes(':') || !book.tlds[type.k]) fail(path, 'state type arguments must name local or Base definitions');
      const head = `${book.tlds[type.k].b ? '' : 'Entry.'}${type.k}`;
      if (type.$ === 'Ref') return head;
      if (type.r.length) fail(path, 'refined state type applications are not supported');
      return `${head}<${type.x.map(argument => code(argument, depth + 1)).join(', ')}>`;
    }
    if (type.$ === 'Qua' || (type.$ === 'Lit' && ['Nat', 'U32'].includes(type.k))) return Bend.term_show(type);
    fail(path, 'internal state type arguments must be closed named types, quantities, or integer literals');
  }
  return { text: Bend.term_show(term), code: code(term) };
}

function record(term, path) {
  const type = ref(term, path);
  const adt = book.tlds[type];
  if (!adt || adt.$ !== 'ADT' || adt.n !== 0 || type.includes(':')) fail(path, `${type} must be a local concrete datatype`);
  const kind = lowered(adt.T);
  if (kind.$ !== 'Typ' || kind.g.$ !== 'Qua' || kind.g.q.$ !== 'Many') fail(path, `${type} must be declared is Data, not Type`);
  if (adt.c.length !== 1) fail(path, `${type} must have one constructor in this slice`);
  const constructor = adt.c[0];
  if (constructor.n < 1 || constructor.n > 61) fail(path, 'requires 1 through 61 U32 fields within the native payload bound');
  let rest = lowered(constructor.T);
  const fields = [];
  for (let index = 0; index < constructor.n; index++) {
    if (rest.$ !== 'All' || rest.q.$ === 'None') fail(path, 'erased fields are not supported');
    const field = name(rest.k, path);
    if (rest.A.$ !== 'Ref' || rest.A.k !== 'U32') fail(`${path}.${field}`, `${Bend.term_show(rest.A)} is not supported Wire Data in this slice; use a concrete U32 field`);
    fields.push(field);
    rest = rest.B;
  }
  if (rest.$ !== 'ADT' || rest.k !== type || rest.x.length || rest.r.length) fail(path, 'dependent datatype results are not supported');
  return { type, constructor: constructor.k, fields };
}

try {
  await Bend.book_load(book, entry, '', seen);
  Bend.book_valid(book);
  if (book.hols) fail(entry, 'incomplete definitions or unresolved holes');
  const exports = book.order.filter(key => key.startsWith('api.') && book.tlds[key]?.m === '').sort();
  if (!exports.length) fail(entry, 'no entry-module api.* services');
  const services = exports.map(key => {
    const suffix = name(key.slice(4), key);
    if (suffix === 'sessions' || RECURSIVE_CLIENT_UNWRAP_KEYS.has(suffix)) fail(key, `reserved endpoint name ${suffix}`);
    const init = `lifecycle.init.${suffix}`;
    const finalize = `lifecycle.finalize.${suffix}`;
    const initialized = signature(init, 0);
    const closed = signature(finalize, 1);
    const transition = signature(key, 2);
    const state = stateType(io(initialized.result, init), init);
    const [replacement, response] = pair(io(transition.result, key), key);
    if (stateType(transition.parameters[0].type, key).code !== state.code || stateType(replacement, key).code !== state.code || stateType(closed.parameters[0].type, finalize).code !== state.code) {
      fail(key, 'initializer, transition, and finalizer must use the same state type');
    }
    if (ref(io(closed.result, finalize), finalize) !== 'Unit') fail(finalize, 'requires IO(Unit)');
    const parameter = name(transition.parameters[1].name, key);
    return { name: suffix, state: state.text, stateCode: state.code, initialize: init, transition: key, finalize, parameter,
      request: record(transition.parameters[1].type, `${key}.args.${parameter}`),
      response: record(response, `${key}.result`) };
  });
  for (const key of book.order) {
    if (book.tlds[key]?.m === '' && /^lifecycle\.(init|finalize)\./.test(key) && !services.some(service => key === service.initialize || key === service.finalize)) {
      fail(key, 'orphan lifecycle declaration has no exported service');
    }
    if (!book.tlds[key]?.b && book.tlds[key]?.i) fail(key, 'foreign effects are not supported by this build slice');
  }
  const sources = [...seen.keys()].filter(file => file !== Bend.BASE_BEND);
  for (const file of sources) {
    const path = relative(dirname(entry), file);
    if (isAbsolute(path) || path === '..' || path.startsWith('../')) fail(file, 'imports must stay within the entry directory in this slice');
  }
  process.stdout.write(JSON.stringify({ services, sources }));
} catch (error) {
  process.stderr.write((error?.$ === 'Err' ? Bend.err_show(error) : error.message ?? String(error)) + '\n');
  process.exitCode = 1;
}
