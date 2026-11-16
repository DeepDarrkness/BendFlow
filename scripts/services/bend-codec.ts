import type { WireType, WireField } from './inspect.ts';

export function bendType(type: WireType): string {
  switch (type.kind) {
    case 'u32': return 'U32';
    case 'bool': return 'Bool';
    case 'nat': return 'Nat';
    case 'f32': return 'F32';
    case 'unit': return 'Unit';
    case 'string': return 'String';
    case 'pair': return `(${bendType(type.left)} & ${bendType(type.right)})`;
    case 'record': case 'union': case 'list': return type.bendType;
    default: { const exhaustive: never = type; return exhaustive; }
  }
}

export function bendCodecs() {
  const definitions: string[] = [];
  let serial = 0;
  const bytes = 'List<&2, U32>';
  function emit(type: WireType): string {
    const id = `wire${serial++}`, T = bendType(type), split = `Maybe<&1, ${T} & ${bytes}>`;
    const fields = type.kind === 'pair' ? [{ name: 'left', value: type.left }, { name: 'right', value: type.right }] : type.kind === 'record' ? type.fields : [];
    function product(prefix: string, fields: readonly WireField[], construct: (values: string[]) => string): { decode: string; encode: string; pattern: string } {
      const children = fields.map((field, index) => ({ ...field, index, id: emit(field.value) }));
      const vars = children.map(child => `v${child.index}`), pattern = construct(vars);
      for (const child of [...children].reverse()) {
        const previous = children.slice(0, child.index);
        const params = previous.map(value => `v${value.index}: ${bendType(value.value)}`);
        const next = children[child.index + 1];
        definitions.push(`def ${prefix}.step${child.index}(got: Maybe<&1, ${bendType(child.value)} & ${bytes}>${params.length ? ', ' + params.join(', ') : ''}) -> ${split}:
  match got:
    case None{}:
      None{}
    case Some{(v${child.index}, rest)}:
      ${next ? `${prefix}.step${next.index}(${next.id}.decode(rest), ${vars.slice(0, next.index).join(', ')})` : `Some{(${pattern}, rest)}`}
`);
      }
      const first = children[0];
      return { pattern, decode: first ? `${prefix}.step0(${first.id}.decode(bytes))` : `Some{(${pattern}, bytes)}`,
        encode: children.length ? `do Maybe<&1, ${bytes}>:\n${children.map(child => `        b${child.index} : ${bytes} <- ${child.id}.encode(v${child.index})`).join('\n')}\n        return ${children.reduceRight((tail, child) => `List.append(&2, U32, b${child.index}, ${tail})`, '[]')}` : 'Some{[]}' };
    }
    let decode: string, encode: string;
    switch (type.kind) {
      case 'unit': decode = 'Some{(Unit{}, bytes)}'; encode = 'Some{[]}'; break;
      case 'u32': case 'nat': case 'f32': case 'bool': case 'string': {
        const take = type.kind === 'nat' ? 'nat' : type.kind === 'string' ? 'text' : type.kind === 'bool' ? 'u8' : 'u32';
        const Split = type.kind === 'nat' ? 'SplitNat' : type.kind === 'string' ? 'SplitText' : 'SplitU32';
        if (type.kind === 'bool') definitions.push(`def ${id}.bool(got: Maybe<&2, Bool>, rest: ${bytes}) -> ${split}:\n  match got:\n    case None{}:\n      None{}\n    case Some{value}:\n      Some{(value, rest)}\n`);
        definitions.push(`def ${id}.got(got: Maybe<&2, Bytes.${Split}>) -> ${split}:\n  match got:\n    case None{}:\n      None{}\n    case Some{Bytes.${Split}{v, rest}}:\n      ${type.kind === 'bool' ? `${id}.bool(Bytes.u8_bool(v), rest)` : `Some{(${type.kind === 'f32' ? 'Wire.float(v)' : 'v'}, rest)}`}\n`);
        decode = `${id}.got(${type.kind === 'string' ? 'Wire' : 'Bytes'}.take_${take}(${type.kind === 'string' ? `${type.maxBytes}, ` : ''}bytes))`;
        encode = type.kind === 'nat' ? 'Wire.nat(value)' : type.kind === 'string' ? `Wire.text(${type.maxBytes}, value)` : `Some{Bytes.encode_${type.kind === 'bool' ? 'u8' : 'u32'}(${type.kind === 'f32' ? 'Wire.bits(value)' : type.kind === 'bool' ? 'Bytes.bool_u8(value)' : 'value'})}`;
        break;
      }
      case 'pair': case 'record': {
        const p = product(id, fields, vars => type.kind === 'pair' ? `(${vars.join(', ')})` : `${type.constructor}{${vars.join(', ')}}`);
        decode = p.decode;
        encode = `match value:\n    case ${p.pattern}:\n      ${p.encode.replaceAll('\n', '\n  ')}`;
        break;
      }
      case 'union': {
        const cases = type.cases.map((value, tag) => ({ ...product(`${id}.case${tag}`, value.fields, vars => `${value.constructor}{${vars.join(', ')}}`), tag }));
        definitions.push(`def ${id}.tag(tag: U32, bytes: ${bytes}) -> ${split}:\n  match tag:\n${cases.map(value => `    case ${value.tag}:\n      ${value.decode}`).join('\n')}\n    case other:\n      None{}\n`);
        definitions.push(`def ${id}.prefix(got: Maybe<&2, Bytes.SplitU32>) -> ${split}:\n  match got:\n    case None{}:\n      None{}\n    case Some{Bytes.SplitU32{tag, rest}}:\n      ${id}.tag(tag, rest)\n`);
        decode = `${id}.prefix(Bytes.take_u8(bytes))`;
        encode = `match value:\n${cases.map(value => `    case ${value.pattern}:\n      do Maybe<&1, ${bytes}>:\n        encoded : ${bytes} <- (\n          ${value.encode.replaceAll('\n', '\n  ')}\n        )\n        return ${value.tag} <> encoded`).join('\n')}`;
        break;
      }
      case 'list': {
        const child = emit(type.element), E = bendType(type.element);
        definitions.push(`type ${id}Job is Type:
  ${id}Need{n: Nat, bytes: ${bytes}, acc: ${T}}
  ${id}Got{n: Nat, got: Maybe<&1, ${E} & ${bytes}>, acc: ${T}}

def ${id}.go(fuel: Nat, job: ${id}Job) -> ${split}:
  match fuel:
    case 0n:
      None{}
    case 1n+p:
      match job:
        case ${id}Need{n, bytes, acc}:
          match n:
            case 0n:
              Some{(List.reverse(&2, ${E}, acc), bytes)}
            case 1n+m:
              ${id}.go(p, ${id}Got{m, ${child}.decode(bytes), acc})
        case ${id}Got{n, got, acc}:
          match got:
            case None{}:
              None{}
            case Some{(v, rest)}:
              ${id}.go(p, ${id}Need{n, rest, v <> acc})

def ${id}.put(fuel: Nat, value: ${T}, acc: ${bytes}, +count: U32) -> Maybe<&1, ${bytes}>:
  match fuel:
    case 0n:
      None{}
    case 1n+p:
      match value:
        case Nil{}:
          Some{count <> acc}
        case h <> tail:
          do Maybe<&1, ${bytes}>:
            encoded : ${bytes} <- ${child}.encode(h)
            ${id}.put(p, tail, List.append(&2, U32, acc, encoded), (count + 1 : U32))

def ${id}.prefix(got: Maybe<&2, Bytes.SplitU32>) -> ${split}:
  match got:
    case None{}:
      None{}
    case Some{Bytes.SplitU32{+n, rest}}:
      do Maybe<&1, ${T} & ${bytes}>:
        valid : Unit <- Wire.guard(U32.is_le(n, ${type.maxItems}))
        ${id}.go(${2 * type.maxItems + 1}n, ${id}Need{U32.to_nat(n), rest, []})
`);
        decode = `${id}.prefix(Bytes.take_u8(bytes))`;
        encode = `${id}.put(${type.maxItems + 1}n, value, [], 0)`;
        break;
      }
      default: { const exhaustive: never = type; throw new Error(String(exhaustive)); }
    }
    definitions.push(`def ${id}.decode(bytes: ${bytes}) -> ${split}:\n  ${decode}\n\ndef ${id}.encode(value: ${T}) -> Maybe<&1, ${bytes}>:\n  ${encode}\n`);
    return id;
  }
  return { emit, definitions };
}
