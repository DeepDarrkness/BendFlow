import type { WireType } from './inspect.ts';

const q = JSON.stringify;
export function schema(type: WireType): string {
  switch (type.kind) {
    case 'u32': return 'u32';
    case 'bool': return 'z.boolean()';
    case 'nat': return 'nat';
    case 'f32': return 'z.strictObject({bits: u32})';
    case 'unit': return 'z.null()';
    case 'string': return `z.string().refine(value => value.isWellFormed() && Buffer.byteLength(value, 'utf8') <= ${type.maxBytes}, 'Invalid or oversized Unicode text')`;
    case 'pair': return `z.tuple([${schema(type.left)}, ${schema(type.right)}])`;
    case 'list': return `z.array(${schema(type.element)}).max(${type.maxItems})`;
    case 'record': return `z.strictObject({${type.fields.map(field => `${q(field.name)}: ${schema(field.value)}`).join(', ')}})`;
    case 'union': return `z.discriminatedUnion('kind', [${type.cases.map(value => `z.strictObject({kind: z.literal(${q(value.name)}), fields: ${schema({kind: 'record', bendType: type.bendType, constructor: value.constructor, fields: value.fields})}})`).join(', ')}])`;
    default: { const exhaustive: never = type; return exhaustive; }
  }
}
export function encode(type: WireType, value: string, depth = 0): string {
  switch (type.kind) {
    case 'u32': return `out.u32(${value});`;
    case 'f32': return `out.u32(${value}.bits);`;
    case 'bool': return `out.u8(${value} ? 1 : 0);`;
    case 'nat': return `out.nat(BigInt(${value}));`;
    case 'unit': return '';
    case 'string': return `out.text(${value}, ${type.maxBytes});`;
    case 'pair': return `${encode(type.left, `${value}[0]`, depth)}\n${encode(type.right, `${value}[1]`, depth)}`;
    case 'record': return type.fields.map(field => encode(field.value, `${value}[${q(field.name)}]`, depth)).join('\n');
    case 'list': return `out.u8(${value}.length); for (const item${depth} of ${value}) { ${encode(type.element, `item${depth}`, depth + 1)} }`;
    case 'union': return `switch (${value}.kind) {${type.cases.map((variant, tag) => `case ${q(variant.name)}: out.u8(${tag}); ${variant.fields.map(field => encode(field.value, `${value}.fields[${q(field.name)}]`, depth)).join('\n')} break;`).join('\n')}}`;
    default: { const exhaustive: never = type; return exhaustive; }
  }
}
export function decode(type: WireType): string {
  switch (type.kind) {
    case 'u32': return 'reader.u32()';
    case 'f32': return '{bits: reader.u32()}';
    case 'bool': return 'boolean(reader.u8())';
    case 'nat': return 'reader.nat().toString(10)';
    case 'unit': return 'null';
    case 'string': return `reader.text(${type.maxBytes})`;
    case 'pair': return `[${decode(type.left)}, ${decode(type.right)}]`;
    case 'record': return `{${type.fields.map(field => `${q(field.name)}: ${decode(field.value)}`).join(', ')}}`;
    case 'list': return `Array.from({length: count(reader.u8(), ${type.maxItems})}, () => (${decode(type.element)}))`;
    case 'union': return `(() => {switch(reader.u8()) {${type.cases.map((value, tag) => `case ${tag}: return {kind: ${q(value.name)}, fields: {${value.fields.map(field => `${q(field.name)}: ${decode(field.value)}`).join(', ')}}};`).join('\n')} default: throw new Error('Invalid generated union tag');}})()`;
    default: { const exhaustive: never = type; return exhaustive; }
  }
}
