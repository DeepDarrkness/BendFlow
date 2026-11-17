# Phase 4 implementation design

## Goal and usage

Generate stateless typed calls from Bend declarations, retain infrastructure inside host-owned workers, and ship an independently usable Node package. DB connectors and GPU qualification remain separate.

```ts
	import { startGateway, createClient } from './generated/index.js';
	const gateway = await startGateway({ worker: { threads: 'auto' } });
	const client = createClient(gateway.url);
	const value = await client.add({ a: 7, b: 5 });
	await gateway.close();
```

## Shape

One host owns a map of endpoint workers. Each worker has one active invocation and a bounded FIFO. Lifecycle state is infrastructure and remains outside endpoint arguments. Gateway sessions never select a worker. Fatal failure retires the affected worker; fresh calls can acquire replacement infrastructure after cleanup. Uncertain calls are never replayed.

The generated protocol uses frame version 2, U32 container lengths, and a configurable maximum of 1,048,576 native payload bytes. The eight-byte header and four-byte frame prefix are additional framing overhead. A successful reply's one-byte connector tag counts toward the payload budget. Legacy Phase 2 frames retain version 1 and their 256-byte body limit.

Resolved limits drive extraction, sizing, codecs, HTTP descriptions, and fingerprints. Enforce text, item, nesting, and total-value complexity limits, plus queue-byte admission. Use linear byte builders and bounded reads. Native reply tags distinguish success, request rejection, and output-encoding failure. Base Result/Maybe are recognized by identity; only a top-level Base Fail is observed as a domain failure.

Compiled package exports hide source layout. A local pinned compiler-resource manifest supports verified cache materialization outside `node_modules`. A Node compiler driver emits CPU C; Clang builds the executable. Generated imports use package exports, generated output includes JavaScript and declarations, and deployed code resolves its native assets relative to its own module.

The implementation owner may retain the existing emitter and synchronous build signatures where they reduce migration work. Generated end-user calls must have one stateless shape. HTTP and OpenAPI must share the actual strict request and response envelopes. Logger failures never change replies. CPU auto is explicit and remains within the 1–64 thread range.

## Synthesis decision

Two independent candidate sketches compared endpoint workers with a common multi-endpoint native process. Both selected endpoint workers. That preserves existing lifecycle declarations and isolates failures without introducing a composed affine context. Use the smaller public API and reuse existing runtime mechanisms. A common live context across endpoints is deferred.

Both candidates proposed a 1 MiB body limit. The selected definition instead uses 1 MiB payload bytes to match the approved feasibility report. Adopt bounded aggregate admission and detached logger snapshots from the candidates. Do not adopt a broad new adapter framework or preserve generated execution-session controllers.

The host cannot select a different model family, so the cross-model judge did not run. The lead inspected both candidates and chose the shared ownership shape against five criteria: stateless calls, exclusive handles and no replay, bounded messages, installable compiled exports, and a small public interface. Executable verification is still required.

## Verification order

1. Preserve the baseline legacy unit suite.
2. Verify versioned framing, wider lengths, and independent codec vectors.
3. Verify native outcomes, stateless ownership, recovery, and error observation.
4. Verify live HTTP against generated OpenAPI and exact client types.
5. Pack the actual package, install it in an unrelated consumer, generate and relocate endpoints, and invoke them without build tools.

No commit or external publication is part of this implementation request.
