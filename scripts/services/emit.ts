import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import type { ServiceDescription, WireType } from './inspect.ts';
import { analyzeWire, checkServiceBounds, maxServiceBodyBytes } from './wire.ts';
import { bendCodecs, bendType } from './bend-codec.ts';
import { schema, encode, decode } from './node-codec.ts';

const quote = JSON.stringify;

export function contractId(service: ServiceDescription): string {
  checkServiceBounds(service);
  const wire = [2, 'be/exact/utf8-bom/nat48/u8-length/declaration-tags', service.name,
    service.args.map(field => [field.name, analyzeWire(field.value).canonical]), analyzeWire(service.reply).canonical];
  return `BendFlow/service/v2/${createHash('sha256').update(JSON.stringify(wire)).digest('hex')}`;
}

export function emitWorker(service: ServiceDescription, entry: string, imports: readonly { alias: string; path: string }[] = []): string {
  checkServiceBounds(service);
  const codecs = bendCodecs();
  const requestShape = service.args.reduceRight<WireType>((right, field) => ({ kind: 'pair', left: field.value, right }), {kind: 'unit'});
  const requestCodec = codecs.emit(requestShape);
  const reply = codecs.emit(service.reply);
  const response = bendType(service.reply);
  const state = service.kind === 'stateful' ? `(${service.stateCode})` : 'Unit';
  const pair = `${state} & List<&2, U32>`;
  const request = bendType(requestShape);
  const vars = service.args.map((_, i) => `v${i}`);
  const pattern = vars.reduceRight((tail, v) => `(${v}, ${tail})`, 'unit');
  const invocation = `Entry.${service.call}(${[...(service.kind === 'stateful' ? ['state'] : []), ...vars].join(', ')})`;
  return `import Base
import ./source/${basename(entry)} as Entry
${imports.map(value => `import ./source/${value.path} as ${value.alias}`).join('\n')}
import ./runtime/loop.bend as Loop
import ./runtime/bytes.bend as Bytes
import ./runtime/wire.bend as Wire

def contract(_: Unit) -> List<&2, U32>:
  [${[...Buffer.from(contractId(service), 'ascii')].join(', ')}]

${codecs.definitions.join('\n')}

def packed(result: ${state} & ${response}) -> ${pair}:
  (state, response) = result
  (state, Wire.envelope(${reply}.encode(response)))

def applied(state: ${state}, request: Maybe<&1, ${request} & List<&2, U32>>) -> IO(${pair}):
  match request:
    case None{}:
      IO.pure(${pair}, (state, Loop.invalid()))
    case Some{(${pattern}, rest)}:
      match rest:
        case Nil{}:
          do IO<${pair}>:
${service.kind === 'stateful' ? `            result : ${state} & ${response} <- ${invocation}\n            return packed(result)` : service.kind === 'io' ? `            response : ${response} <- ${invocation}\n            return packed((state, response))` : `            return packed((state, ${invocation}))`}
        case other:
          IO.pure(${pair}, (state, Loop.invalid()))

def handle(state: ${state}, op: U32, payload: List<&2, U32>) -> IO(${pair}):
  match op:
    case 1:
      applied(state, ${requestCodec}.decode(payload))
    case other:
      IO.pure(${pair}, (state, Loop.invalid()))

def shutdown(state: ${state}) -> IO(Unit):
  ${service.kind === 'stateful' ? `Entry.${service.finalize}(state)` : 'IO.pure(Unit, Unit{})'}

def main() -> IO(Unit):
  do IO<Unit>:
    state : ${state} <- ${service.kind === 'stateful' ? `Entry.${service.initialize}()` : 'IO.pure(Unit, Unit{})'}
    Loop.run(~${state}, ~handle, ~shutdown, ~contract, ~"usage: ${service.name} PORT", state)
`;
}

export function emitContracts(services: readonly ServiceDescription[], sessionImport: string): string {
  const schemas = services.map(service => `export const ${service.name}ArgsSchema = z.strictObject({ ${service.args.map(field => `${quote(field.name)}: ${schema(field.value)}`).join(', ')} });
export const ${service.name}ReplySchema = ${schema(service.reply)};
export type ${service.name}Args = z.infer<typeof ${service.name}ArgsSchema>;
export type ${service.name}Reply = z.infer<typeof ${service.name}ReplySchema>;`).join('\n');
  return `import { oc } from '@orpc/contract';
import { z } from 'zod';
import { sessionIdSchema } from ${quote(sessionImport)};
export { sessionIdSchema } from ${quote(sessionImport)};
const u32 = z.number().int().min(0).max(0xffffffff);
const nat = z.string().max(15).refine(value => /^(0|[1-9][0-9]*)$/.test(value) && value.length <= 15 && BigInt(value) <= 281474976710655n, 'Nat requires canonical decimal text within 48 bits');
const char = z.string().refine(value => value.isWellFormed() && [...value].length === 1, 'Char requires one Unicode scalar');
export const serviceSchema = z.enum([${services.map(service => quote(service.name)).join(', ')}]);
export const createdSchema = z.strictObject({ sessionId: sessionIdSchema, service: serviceSchema });
export const okSchema = z.strictObject({ kind: z.literal('ok') });
${schemas}
export const contract = {
  sessions: {
    create: oc.input(z.strictObject({ service: serviceSchema })).output(createdSchema),
    close: oc.input(z.strictObject({ sessionId: sessionIdSchema })).output(okSchema),
  },
${services.map(service => `  ${quote(service.name)}: oc.input(z.strictObject({ sessionId: sessionIdSchema, args: ${service.name}ArgsSchema })).output(${service.name}ReplySchema),`).join('\n')}
};
`;
}

export function emitNative(services: readonly ServiceDescription[], imports: { codec: string; bytes: string; host: string }): string {
  return `import { fileURLToPath } from 'node:url';
import * as codecRuntime from ${quote(imports.codec)};
import { BytesReader, BytesWriter } from ${quote(imports.bytes)};
import * as serviceRuntime from ${quote(imports.host)};
import { ${services.flatMap(service => [`${service.name}ArgsSchema`, `${service.name}ReplySchema`]).join(', ')} } from './contract.ts';
function boolean(tag: number): boolean {
  if (tag !== 0 && tag !== 1) throw new Error('Invalid generated boolean tag');
  return tag === 1;
}
function count(value: number, max: number): number {
  if (value > max) throw new Error('Generated list exceeds bound');
  return value;
}
function character(code: number): string {
  if (code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) throw new Error('Invalid generated Unicode scalar');
  return String.fromCodePoint(code);
}
function characterCode(value: string): number {
  const code = value.codePointAt(0);
  if (code === undefined) throw new Error('Missing generated Unicode scalar');
  return code;
}
${services.map(service => `export const ${service.name}Codec = codecRuntime.validatedCodec({
  contract: ${quote(contractId(service))},
  parse: (input: unknown) => ${service.name}ArgsSchema.parse(input),
  encode(args: ReturnType<typeof ${service.name}ArgsSchema.parse>) {
    const out = new BytesWriter();
    ${service.args.map(field => encode(field.value, `args[${quote(field.name)}]`)).join('\n    ')}
    return out.toBuffer();
  },
  decode(payload: Buffer) {
    const reader = new BytesReader(payload);
    if (reader.u8() !== 0) throw new Error('Invalid generated service reply tag');
    const result = ${decode(service.reply)};
    reader.finish();
    return ${service.name}ReplySchema.parse(result);
  },
}, ${service.name}ReplySchema);
export const ${service.name}Service = serviceRuntime.defineService({ name: ${quote(service.name)}, codec: ${service.name}Codec,
  reply: ${service.name}ReplySchema, executable: fileURLToPath(new URL(${quote(`./native/worker-${service.name}`)}, import.meta.url)) });`).join('\n')}
export const services = [${services.map(service => `${service.name}Service`).join(', ')}];
`;
}

export function emitServer(services: readonly ServiceDescription[], imports: { host: string; worker: string }): string {
  return `import { createServer } from 'node:http';
import { implement, ORPCError } from '@orpc/server';
import { RPCHandler, BodyLimitPlugin } from '@orpc/server/node';
import { ServiceHost, ServiceLookupError, ServiceLimitError, ServiceWaitError, type ServiceHostOptions } from ${quote(imports.host)};
import { WorkerError } from ${quote(imports.worker)};
import { contract, createdSchema, okSchema } from './contract.ts';
import { services, ${services.map(service => `${service.name}Service`).join(', ')} } from './native.ts';

async function rpc<Result>(action: () => Promise<Result>): Promise<Result> {
  try { return await action(); }
  catch (error) {
    if (error instanceof ServiceLookupError) throw new ORPCError('NOT_FOUND', { message: error.message });
    if (error instanceof ServiceLimitError) throw new ORPCError('TOO_MANY_REQUESTS', { message: error.message });
    if (error instanceof ServiceWaitError) throw new ORPCError('GATEWAY_TIMEOUT', { message: error.message });
    if (!(error instanceof WorkerError)) throw error;
    if (error.code === 'DEADLINE') throw new ORPCError('GATEWAY_TIMEOUT', { message: error.message });
    throw new ORPCError('SERVICE_UNAVAILABLE', { message: error.message });
  }
}

export async function startGateway(options: ServiceHostOptions & { port?: number } = {}) {
  const host = new ServiceHost(services, options);
  const impl = implement(contract);
  const router = impl.router({
    sessions: {
      create: impl.sessions.create.handler(({ input }) => rpc(async () => createdSchema.parse(await host.create(input.service)))),
      close: impl.sessions.close.handler(({ input }) => rpc(async () => {
        await host.closeSession(input.sessionId);
        return okSchema.parse({ kind: 'ok' });
      })),
    },
${services.map(service => `    ${quote(service.name)}: impl[${quote(service.name)}].handler(({ input }) => rpc(() => host.invoke(${service.name}Service, input.sessionId, input.args))),`).join('\n')}
  });
  const handler = new RPCHandler(router, { plugins: [new BodyLimitPlugin({ maxBodySize: ${Math.max(...services.map(maxServiceBodyBytes))} })] });
  const server = createServer((request, response) => {
    void handler.handle(request, response, { prefix: '/rpc' }).then(({ matched }) => {
      if (!matched) { response.statusCode = 404; response.end('Not found'); }
    }).catch(() => {
      if (!response.headersSent) response.statusCode = 500;
      response.end();
    });
  });
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(options.port ?? 0, '127.0.0.1', resolve);
    });
  } catch (error) { await host.close(); throw error; }
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected an IPv4 gateway');
  let cleanup: Promise<void> | undefined;
  return {
    url: 'http://127.0.0.1:' + address.port + '/rpc',
    get workerPids() { return host.workerPids; },
    close(): Promise<void> {
      cleanup ??= (async () => {
        const stopped = new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
        server.closeAllConnections();
        await Promise.all([host.close(), stopped]);
      })();
      return cleanup;
    },
  };
}
`;
}

export function emitClient(framingImport: string): string {
  return `import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import { getContractRouter, isContractProcedure, type ContractRouterClient } from '@orpc/contract';
import { ProtocolError } from ${quote(framingImport)};
import { contract } from './contract.ts';
export function createClient(url: string): ContractRouterClient<typeof contract> {
  const link = new RPCLink({ url, fetch: (request, init) => fetch(request, {
    ...init, signal: AbortSignal.any([request.signal, AbortSignal.timeout(10000)]),
  }) });
  return createORPCClient<ContractRouterClient<typeof contract>>({
    async call(path, input, options) {
      const procedure = getContractRouter(contract, path);
      if (!procedure || !isContractProcedure(procedure)) throw new ProtocolError('Unknown generated endpoint');
      const result = await link.call(path, input, options);
      const validated = await procedure['~orpc'].outputSchema?.['~standard'].validate(result);
      if (!validated || validated.issues) throw new ProtocolError('Malformed generated endpoint reply');
      return validated.value;
    },
  });
}
`;
}
