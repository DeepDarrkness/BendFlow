import type { ServiceDescription, WireField, WireType } from './inspect.ts';

function jsonStringBytes(length: number): number {
  return 2 + 6 * length;
}

function jsonObjectBytes(fields: readonly { name: string; bytes: number }[]): number {
  return 2 + Math.max(0, fields.length - 1) + fields.reduce((sum, field) => sum + jsonStringBytes(field.name.length) + 1 + field.bytes, 0);
}

function jsonFieldsBytes(fields: readonly WireField[]): number {
  return jsonObjectBytes(fields.map(field => ({name:field.name,bytes:maxJsonBytes(field.value)})));
}

export function maxJsonBytes(type: WireType): number {
  switch (type.kind) {
    case 'u32': return 10;
    case 'nat': return jsonStringBytes(15);
    case 'f32': return jsonObjectBytes([{name:'bits',bytes:10}]);
    case 'bool': return 5;
    case 'unit': return 4;
    case 'string': return jsonStringBytes(type.maxBytes);
    case 'pair': return 3 + maxJsonBytes(type.left) + maxJsonBytes(type.right);
    case 'list': return 2 + Math.max(0,type.maxItems - 1) + type.maxItems * maxJsonBytes(type.element);
    case 'record': return jsonFieldsBytes(type.fields);
    case 'union': return Math.max(...type.cases.map(value => jsonObjectBytes([
      {name:'kind',bytes:jsonStringBytes(value.name.length)}, {name:'fields',bytes:jsonFieldsBytes(value.fields)},
    ])));
    default: { const exhaustive: never = type; return exhaustive; }
  }
}

export function maxServiceBodyBytes(service: ServiceDescription): number {
  const envelope = (bytes: number) => jsonObjectBytes([{name:'json',bytes}]);
  const session = {name:'sessionId',bytes:jsonStringBytes(36)};
  const bytes = Math.max(4096,
    envelope(jsonObjectBytes([session,{name:'args',bytes:jsonFieldsBytes(service.args)}])),
    envelope(jsonObjectBytes([{name:'service',bytes:jsonStringBytes(service.name.length)}])),
    envelope(jsonObjectBytes([session])));
  if (!Number.isSafeInteger(bytes)) throw new Error(`api.${service.name}: maximum HTTP JSON envelope exceeds safe integer size; use smaller boundaries`);
  return bytes;
}

export function analyzeWire(type: WireType): { canonical: unknown; maxBytes: number } {
  switch (type.kind) {
    case 'u32': case 'f32': return { canonical: [type.kind], maxBytes: 4 };
    case 'bool': return { canonical: ['bool'], maxBytes: 1 };
    case 'nat': return { canonical: ['nat48'], maxBytes: 6 };
    case 'unit': return { canonical: ['unit'], maxBytes: 0 };
    case 'string': return { canonical: ['string', type.maxBytes], maxBytes: 1 + type.maxBytes };
    case 'pair': {
      const left = analyzeWire(type.left), right = analyzeWire(type.right);
      return { canonical: ['pair', left.canonical, right.canonical], maxBytes: left.maxBytes + right.maxBytes };
    }
    case 'list': {
      const element = analyzeWire(type.element);
      return { canonical: ['list', type.maxItems, element.canonical], maxBytes: 1 + type.maxItems * element.maxBytes };
    }
    case 'record': {
      const fields = type.fields.map(field => ({ name: field.name, ...analyzeWire(field.value) }));
      return { canonical: ['record', fields.map(field => [field.name, field.canonical])], maxBytes: fields.reduce((sum, field) => sum + field.maxBytes, 0) };
    }
    case 'union': {
      const cases = type.cases.map(value => ({ name: value.name, ...analyzeWire({ kind: 'record', bendType: type.bendType, constructor: value.constructor, fields: value.fields }) }));
      return { canonical: ['union', cases.map(value => [value.name, value.canonical])], maxBytes: 1 + Math.max(...cases.map(value => value.maxBytes)) };
    }
    default: { const exhaustive: never = type; return exhaustive; }
  }
}

export function checkServiceBounds(service: ServiceDescription): void {
  const request = service.args.reduce((size, field) => size + analyzeWire(field.value).maxBytes, 0);
  const reply = 1 + analyzeWire(service.reply).maxBytes;
  if (request > 248 || reply > 248) throw new Error(`api.${service.name}: worst-case request ${request}, reply with tag ${reply} exceeds 248 bytes; set explicit --max-text/--max-items bounds or use a smaller boundary`);
}
