import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import type { ServiceDescription } from './inspect.ts';

const quote = JSON.stringify;

export function contractId(service: ServiceDescription): string {
  const wire = { version: 1, policy: 'u32-record-v1', name: service.name, parameter: service.parameter,
    request: service.request.fields, response: service.response.fields };
  return `BendFlow/service/v1/${createHash('sha256').update(JSON.stringify(wire)).digest('hex')}`;
}

export function emitWorker(service: ServiceDescription, entry: string): string {
  const request = `Entry.${service.request.type}`;
  const response = `Entry.${service.response.type}`;
  const state = service.stateCode;
  const pair = `${state} & List<&2, U32>`;
  const words = service.request.fields.map((_, index) => `word(b${index * 4}, b${index * 4 + 1}, b${index * 4 + 2}, b${index * 4 + 3})`);
  const bytes = service.request.fields.flatMap((_, index) => Array.from({ length: 4 }, (_, offset) => `b${index * 4 + offset}`));
  const fields = service.response.fields.map((_, index) => `v${index}`);
  const encoded = fields.reduceRight((tail, field) => `List.append(&2, U32, Bytes.encode_u32(${field}), ${tail})`, '[]');
  return `import Base
import ./source/${basename(entry)} as Entry
import ./runtime/loop.bend as Loop
import ./runtime/bytes.bend as Bytes

def contract(_: Unit) -> List<&2, U32>:
  [${[...Buffer.from(contractId(service), 'ascii')].join(', ')}]

def word(a: U32, b: U32, c: U32, d: U32) -> U32:
  (((a << 24n : U32) .|. (b << 16n : U32) : U32) .|. ((c << 8n : U32) .|. d : U32) : U32)

def decode(bytes: List<&2, U32>) -> Maybe<&2, ${request}>:
  match bytes:
    case ${bytes.join(' <> ')} <> Nil{}:
      Some{Entry.${service.request.constructor}{${words.join(', ')}}}
    case other:
      None{}

def encode(response: ${response}) -> List<&2, U32>:
  match response:
    case Entry.${service.response.constructor}{${fields.join(', ')}}:
      0 <> ${encoded}

def packed(result: ${state} & ${response}) -> ${pair}:
  (state, response) = result
  (state, encode(response))

def applied(state: ${state}, request: Maybe<&2, ${request}>) -> IO(${pair}):
  match request:
    case None{}:
      IO.pure(${pair}, (state, Loop.invalid()))
    case Some{value}:
      do IO<${pair}>:
        result : ${state} & ${response} <- Entry.${service.transition}(state, value)
        return packed(result)

def handle(state: ${state}, op: U32, payload: List<&2, U32>) -> IO(${pair}):
  match op:
    case 1:
      applied(state, decode(payload))
    case other:
      IO.pure(${pair}, (state, Loop.invalid()))

def shutdown(state: ${state}) -> IO(Unit):
  Entry.${service.finalize}(state)

def main() -> IO(Unit):
  do IO<Unit>:
    state : ${state} <- Entry.${service.initialize}()
    Loop.run(~${state}, ~handle, ~shutdown, ~contract, ~"usage: ${service.name} PORT", state)
`;
}

export function emitContracts(services: readonly ServiceDescription[], sessionImport: string): string {
  const schemas = services.map(service => `export const ${service.name}ArgsSchema = z.strictObject({ ${quote(service.parameter)}: z.strictObject({ ${service.request.fields.map(field => `${quote(field)}: u32`).join(', ')} }) });
export const ${service.name}ReplySchema = z.strictObject({ ${service.response.fields.map(field => `${quote(field)}: u32`).join(', ')} });
export type ${service.name}Args = z.infer<typeof ${service.name}ArgsSchema>;
export type ${service.name}Reply = z.infer<typeof ${service.name}ReplySchema>;`).join('\n');
  return `import { oc } from '@orpc/contract';
import { z } from 'zod';
import { sessionIdSchema } from ${quote(sessionImport)};
export { sessionIdSchema } from ${quote(sessionImport)};
const u32 = z.number().int().min(0).max(0xffffffff);
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
${services.map(service => `export const ${service.name}Codec = codecRuntime.validatedCodec({
  contract: ${quote(contractId(service))},
  parse: (input: unknown) => ${service.name}ArgsSchema.parse(input),
  encode(args: ReturnType<typeof ${service.name}ArgsSchema.parse>) {
    const out = new BytesWriter();
    ${service.request.fields.map(field => `out.u32(args[${quote(service.parameter)}][${quote(field)}]);`).join('\n    ')}
    return out.toBuffer();
  },
  decode(payload: Buffer) {
    const reader = new BytesReader(payload);
    if (reader.u8() !== 0) throw new Error('Invalid generated service reply tag');
    const result = { ${service.response.fields.map(field => `${quote(field)}: reader.u32()`).join(', ')} };
    reader.finish();
    return result;
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
  const handler = new RPCHandler(router, { plugins: [new BodyLimitPlugin({ maxBodySize: 4096 })] });
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
