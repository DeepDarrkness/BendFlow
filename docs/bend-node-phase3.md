# BendFlow Phase 3: native typed endpoint generator

## Status

**Completed.** Phase 3 delivers the bounded native service generator and transparent Data boundary described here. Verification on November 16, 2026 passed all 313 tests with zero failures or skips.

Write Bend services as entry-module `api.*` exports and run one build command. The generator produces compiled native workers, Node endpoints, schemas, codecs, contracts, and a typed client. Service authors do not write Node business handlers or duplicate their boundary types.

The [architecture](architecture.md) describes ownership. The [Phase 2 reference](bend-node-phase2.md) describes the portable runtime and device evidence policies.

## Service declarations

Pure and IO services accept zero or more named external arguments. Supported Data parameters may be affine or reusable with `+`.

```bend
	import Base

	def api.add(a: U32, b: U32) -> U32:
	  (a + b : U32)

	def api.greet(name: String) -> IO(String):
	  IO.pure(String, "Hello, " ++ name)

	def api.glyph(+value: Char) -> Char:
	  value
```

These services receive a generated trivial lifecycle. Stateful services use matching declarations:

```text
	lifecycle.init.<name>() -> IO(S)
	api.<name>(state: S, external0: A, ...) -> IO(S & O)
	lifecycle.finalize.<name>(state: S) -> IO(Unit)
```

The initializer and finalizer authorize the internal state parameter by matching its type. State parameters remain affine. Closed generic and nested pair state are supported. State and lifecycle functions do not appear in endpoint arguments or clients. Imported helpers remain internal.

## Data boundary

External callers exchange Data values. Bend retains internal types, effects, resources, and application state. IO executes inside the worker; an IO action never crosses the boundary. A transparent call can perform effects and does not imply transactional rollback.

| Bend value | External representation | Native encoding |
| --- | --- | --- |
| U32 | Integer $0$ through $2^{32}-1$ | Four big-endian bytes |
| Bool | Boolean | Validated zero or one tag |
| Nat | Canonical decimal string, at most $2^{48}-1$ | Six big-endian bytes |
| F32 | `{ bits: number }` | Four bit-pattern bytes |
| String | Well-formed Unicode text | One-byte UTF-8 length and bytes |
| Unit | `null` | Zero bytes |
| Char | String containing exactly one Unicode scalar | Four big-endian code-point bytes |
| Pair | Two-element JSON tuple | Left value, then right value |
| Single-constructor Data | Strict object, including empty records | Fields in declaration order |
| Multi-constructor Data | `{ kind: caseName, fields: object }` | Declaration-order tag and fields |
| `List<&2, A>` | Bounded JSON array | One-byte count and elements |
| Closed generic Data | Expanded concrete shape | Instantiated field encoding |

Imported Data, closed aliases, IO aliases, and finite generic nesting are supported. JSON arrays use reusable Lists, including nested lists. Affine Bend arrays, maps, and handles stay internal. Ordinary nondependent pairs are accepted as structural products with supported members, even though Base gives pairs kind Type.

Char accepts U+0000 and astral characters. Empty strings, lone surrogates, multiple scalars, and native codes above U+10FFFF fail validation. F32 preserves signed zero and NaN payload bits; String preserves BOM. Base Maybe, Result, and Cmp stay internal. Custom Data unions can represent domain success and failure values.

The generator rejects dependent boundaries, proofs, functions, handles, erased fields, affine lists, templates, and recursive business datatypes. Extraction is bounded to 32 nesting levels and 4096 expanded nodes across the entry's services.

Default bounds are 96 UTF-8 bytes per String and 32 items per List. `--max-text` and `--max-items` set explicit nested bounds. Complete requests and successful replies, including the reply tag, must fit 248 native payload bytes. Bounds are never silently reduced.

Native decoding requires complete validation and exact consumption before invocation effects. Output encoding rejects invalid values and oversized strings or lists rather than emitting truncated successes. HTTP body limits derive from escaped JSON shapes, with a 4096-byte minimum.

## Sessions and CPU execution

Each endpoint maps to one Bend service. Each session owns one native worker process and retained state. Node owns session identities, admission, and a FIFO invocation queue. Bend owns computation, effects, state transitions, and finalization.

Workers default to two CPU evaluation threads. `worker.threads` accepts integers from 1 through 64. One selects the native-CPU profile; larger values select multithreaded CPU execution. Both disable GPU execution. The default avoids allocating a full hardware-sized pool for every session.

Each session permits one active invocation and eight waiting invocations by default. Waiting and active-drain limits default to 2000 milliseconds. Parallel Bend computation occurs within the active invocation; session serialization does not impose a one-core limit.

Expired waiting work is never dispatched. Controller abort signals remove queued work. Active abort does not release the active slot before native settlement. Normal closure drains active work and finalizes state. Native failures invalidate waiting work without recreating state or replaying uncertain calls.

## Build and use

```sh
	npm run build:services
	npm run build:services -- --entry examples/services/portable.bend --out build/portable-services --max-text 16 --max-items 4
	npm run build:services -- --entry examples/services/effects.bend --out build/effect-services
```

```ts
	import { startGateway, createClient } from './build/services/index.ts';

	const gateway = await startGateway({ worker: { threads: 4 } });
	const client = createClient(gateway.url);
	try {
	  const { sessionId } = await client.sessions.create({ service: 'counter' });
	  const reply = await client.counter({
	    sessionId,
	    args: { request: { amount: 7 } },
	  });
	  console.log(reply.value);
	  await client.sessions.close({ sessionId });
	} finally {
	  await gateway.close();
	}
```

Sessions are explicit for every service category. Service routes use `POST /rpc/<name>`. Controller routes are `POST /rpc/sessions/create` and `POST /rpc/sessions/close`. Raw HTTP uses the oRPC envelope `{ "json": input }` and receives `{ "json": result }`.

The build checks staged Bend declarations, emits adapters, compiles workers, and typechecks generated TypeScript before replacing output. Generation or compilation failure preserves the preceding package. Replacement is staged but not crash-atomic. Current output uses repository runtime dependencies and native CPU artifacts.

Contract fingerprints include external shapes, field order, public union cases, resolved bounds, and wire policy. Internal record-constructor spelling does not affect identity. Public union renames or reorderings change identity. The native handshake rejects mismatched contracts before invocation. Build metadata records compiler/tool versions, Bend source/runtime hashes, and native artifact hashes.

## Implemented verification

| Command or gate | Observed result |
| --- | --- |
| `npm test` | 313 passed, zero failures or skips; generated builds and TypeScript checks included |
| `npm run check:compiler` | Three positive fixtures and both production proof-verdict entries passed |
| `npm run example` | All three echo payloads matched |
| `npm run example:session` | Totals 7, 14, and 21, then reset and add 5 |
| Portable completion gate | `portable-complete`, no blockers |

Compiler, integration, and type fixtures verify independent golden bytes, nested structures, truncation, trailing bytes, malformed tags and Unicode, exact client types, aliases, generic state, state isolation, queues, and observed affine-file cleanup. Regressions cover prototype-named Data types, reusable parameters, Char ingress and egress, and an invokable preceding package after native compilation failure.

CPU tests observe `IO.thread_count()` and balanced-work results in the same generated stateful service under default two, explicit one, and explicit four threads. Linux checks also observe launch arguments and active evaluation lanes. State counters verify queued ordering after active abort. The HTTP sizing regression accepts a 7,602-byte escaped request through the generated endpoint.

`build/phase2-results.json` contains the executed portable evidence. Examples exercise pure computation, IO, retained arrays/maps, files, process execution, channels, and finite TCP effects. This completed implementation uses native CPU execution; native window, audio, and generated GPU device execution are outside its supported scope.
