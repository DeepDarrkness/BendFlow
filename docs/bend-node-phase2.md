# BendFlow Phase 2 status and scope

## Portable completion

Portable Phase 2 is complete as of November 15, 2026. The last full `npm test` run passed 273 tests, with 0 failures and 0 skips. The current portable completion checker reports no blockers. Full completion of the agreed scope remains in progress because actual CUDA execution and a matching production `.gpu` artifact need a compatible native Linux GPU runner.

The inventory has 77 rows: 74 verified, 0 pending, 1 unavailable GPU row, and 2 excluded window and audio rows. Native window and audio effects are excluded by agreement. Pure image rendering, event-state computation, and sample synthesis are verified portable requirements.

The current portable toolchain is Node `v24.11.0`, Bun `1.3.3`, Bend `2.0.40` at `f0cf0a7c573145501981c44d9c33e326185f008e`, and Ubuntu Clang `18.1.3`. Lean `4.34.0` supports the BendTT kernel check of 25 generic pure-core laws: 15 compute laws and 10 numeric laws connected to production helpers.

The earlier 124-test foundation run and its 34 pending portable rows are historical. The inventory migration and portable implementation are complete. This document is the consolidated Phase 2 status, architecture, protocol, verification, and remaining-work reference.

## Milestone status

| Milestone | Status | Acceptance evidence |
| --- | --- | --- |
| 0. Reproducible baseline | Done | Inventory paths and exact test references load, and the full suite regenerates the executed report. |
| 1. Inventory and completion rules | Done | Missing requirements, duplicate IDs, invalid references, and failed or skipped evidence block verification. Portable and full outcomes remain distinct. |
| 2. Contracts and serialization | Done | Complete encoded bounds, nested structures, native golden vectors, malformed-input rejection, and large-result reassembly agree across Node and Bend. |
| 3. All-kind HTTP gateway | Done | Separate clients repeatedly use and close all eight kinds. Admission, isolation, busy and deadline errors, startup overlap, and cleanup have evidence. |
| 4. Numeric and collection conformance | Done | Independent oracles, language features, arrays, and maximum-size sort order and multiset preservation have evidence. |
| 5. Affine resources and networking | Done | Filesystem and peer observations cover retained ownership, recovery, resource exhaustion, fragmentation, backpressure, UDP metadata, cleanup, and uncertain effects. |
| 6. Tasks, processes, and custom effects | Done | Handshakes prove ownership transfer and exactly-once collection. Process and custom-effect fixtures independently observe inputs, outputs, failures, and recovery. |
| 7. Parallel compute, rendering, and samples | Done | Balanced algorithms agree across one, two, and four CPU threads. Simulation, frames, and samples have independent references and paging evidence. |
| 8. Compiler and pure-core proofs | Done | Positive fixtures pass, invalid fixtures fail for intended diagnostics, and 25 production-connected laws pass the kernel. |
| 9. CUDA artifacts and runner verification | Hardware verification remains | GPU-marked workloads, variants, fallback, instrumentation, evidence validation, HTTP admission, and package checks are implemented. Actual device execution and a matching artifact remain required. |
| 10. Final conformance and publication | Portable done | The portable suite and completion gate pass. Full acceptance depends on milestone 9. |

## Implemented applications

All eight session kinds have typed HTTP create, command, and close routes. Each session owns one persistent native process. Multiple external clients can use the same session ID, while separate sessions retain isolated state and resources.

| Session | Verified scope |
| --- | --- |
| Numeric | Persistent totals, reset, arithmetic, conversion, comparison, booleans, bit operations, parsing and formatting, native bounds, and explicit F32 bits |
| Collection | Nested records and tuples, lists, folds, sets, maps, arrays, sorting, templates, polymorphism, affine closures, dependent structures, monads, and retained item pages |
| File | Retained affine handles, append, EOF, text and bytes, offsets, multiple resources, failure recovery, isolation, cleanup, and retained byte pages |
| Network | Persistent TCP sockets and listeners, accept and polling, fragmentation, half-close and peer failures, backpressure, UDP boundaries and sender metadata, timers, and cleanup |
| Task | Fork and join, spawn and channels, handshake-proven ordering, affine resource transfer, exactly-once collection, timeouts, late effects, and shutdown |
| Process | Environment and arguments, bounded random values, fixed process fixtures, exact input and output, exit status, launch failures, timeouts, and output limits |
| Compute | Balanced sum and sort, CPU thread configurations, stateful simulation and events, deterministic frames, pure samples, paging, and production-connected pure-core laws |
| Custom effect | Registered C effects, returned constructors, immediate results, helper-thread work, parked IO, failure recovery, retained results, isolation, and external writes |

All command families have cross-language golden vectors and malformed-input evidence. HTTP tests independently observe effect families and their applicable failure sequences.

## Code and evidence locations

- `bend/loop.bend` owns the shared native lifecycle, and `bend/bytes.bend` supplies shared wire helpers.
- `contracts/` defines strict command, reply, session, and page schemas.
- `src/protocol/codecs/` implements application codecs. `NativeApp` in `src/app.ts` owns each native process.
- `AppSessions` in `src/apps.ts` owns HTTP session admission, lookup, startup, and shutdown. `src/gateway.ts` exposes the routes, and `src/client.ts` validates replies.
- Tests live under `tests/unit/`, `tests/integration/`, `tests/compiler/`, and `tests/types/`.
- `scripts/conformance/requirements.ts` defines required feature IDs. `tests/conformance/coverage.json` maps them to commands, profiles, exact tests, and independent evidence.
- `build/phase2-results.json` is the generated, Git-ignored executed-test report. Missing, failed, or skipped referenced tests block verified claims.

Native cross-language tests are in `tests/integration/native-codec-vectors.test.ts`, `collection-file-native-vectors.test.ts`, `compute-native-vectors.test.ts`, and `effect-native-vectors.test.ts`. Their compiled fixtures live under `tests/fixtures/codecs/`. Numeric and custom integration tests also check native golden bytes.

Independent observers check exact filesystem writes, controlled TCP and UDP traffic, process arguments and streams, and custom-effect markers. Arithmetic, bit-level, sorting, simulation, pixel, and sample references check pure outputs. Thread counts establish configuration, not a speedup. Process reaping is supplemented by observed native cleanup.

## HTTP routes and execution profiles

`startAppGateway` binds to `127.0.0.1`. Its returned `url` ends in `/rpc`. `createAppClient` supplies typed routes and validates replies against `contracts/apps.ts`.

| Route | Input | Result |
| --- | --- | --- |
| `sessions/create` | A session `kind` and optional `execution` | A session ID, kind, and execution configuration |
| `<kind>/command` | A session ID and that kind's command | That kind's reply union |
| `sessions/close` | A session ID | `{ kind: 'ok' }` |

Session IDs are UUIDs. Native resource IDs are positive `U32` values local to their session. An unknown session or a command routed to the wrong kind returns `NOT_FOUND`. Closing an already closed session returns `ok`.

Execution defaults to `{ profile: 'native-cpu' }`. Multithreaded execution uses `{ profile: 'multithreaded-cpu', threads }`, with an integer thread count between 2 and 64. The contract accepts `{ profile: 'gpu' }` only for compute sessions, subject to the evidence gate described below.

`GET /capabilities` is outside `/rpc`. It lists kinds and execution profiles. Verified configured GPU evidence adds an available entry with `scope: 'sessions'` and `kinds: ['compute']`. The `graphics-audio` profile has `status: 'excluded'` and `scope: 'phase2'`. Availability describes gateway support; executed tests and hardware evidence establish verification.

## Binary values and limits

The client and gateway share an oRPC custom JSON serializer with type ID `1000`. It encodes `Uint8Array` values as byte-integer arrays with oRPC metadata and reconstructs validated bytes on receipt. Plain objects with numeric keys are not byte values.

| Value | Limit or encoding |
| --- | --- |
| HTTP request body | 4096 bytes |
| Native frame body | 256 bytes |
| Native application payload | 248 bytes |
| Default string | 96 UTF-8 bytes |
| Default binary field | 192 bytes |
| Command or page `U32` list | 32 items |
| `Nat` | $0$ through $2^{48}-1$, six bytes on the native wire |
| `U32` and F32 bits | Four big-endian bytes |
| Timer inputs | At most 10000 milliseconds |
| Default session admission | 16 live, starting, or closing sessions |

Commands can impose smaller bounds. Task text, process input and arguments, network hosts, and datagram sends have command-specific limits in their schemas and codecs. TCP and UDP receive sizes range from 1 to 192 bytes; file read sizes range from 0 to 192 bytes. Complete encoded commands and replies must fit the payload bound, including nested fields and metadata.

Strings must contain well-formed Unicode. Node and native decoders reject overlong UTF-8, surrogate encodings, and code points above `U+10FFFF`. Command schemas reject extra fields. Native codecs reject unknown tags, truncated fields, and trailing bytes before effects.

Native string replies have a 96-byte limit. Oversized process or environment output returns `{ kind: 'fail', code: 75, message: 'reply exceeds text bound' }`. Oversized error messages retain their code with a bounded replacement message. These errors do not imply rollback of an external effect.

## Snapshot pages

The shared schemas in `contracts/pages.ts` define these envelopes:

```ts
	{ kind: 'snapshot', snapshot, total }
	{ kind: 'page', snapshot, offset, max } // Request
	{ kind: 'page', snapshot, offset, total, count, done, data } // Reply
	{ kind: 'release', snapshot } // Request
```

The snapshot token is a positive session-local `U32`, distinct from an HTTP session ID. Offsets, totals, and counts measure items for collection and compute pages, and bytes for file pages. `count` equals `data.length`. `done` is true exactly when `offset + count === total`. A nonfinal page cannot be empty. Offset equal to total returns an empty final page; offset beyond total fails.

| Result | Capture command | Maximum total | Maximum page | `data` |
| --- | --- | --- | --- | --- |
| Collection items | `capture` | 1024 items | 32 items | `U32[]` |
| File bytes | `capture` with resource `id` | 65536 bytes | 192 bytes | `Uint8Array` |
| Rendered frame | `render` with depth 0 through 4 | 256 pixels | 32 items | `U32[]` |
| Synthesized samples | `samples` with count 0 through 512 | 512 samples | 32 items | `U32[]` of F32 bits |

Each session retains one snapshot. Collection and file capture replace the previous snapshot after successful capture, making old tokens stale. Ordinary mutations preserve retained data. Their release returns `ok` for an absent or old token and clears data only for the matching token. Capture limits and token exhaustion preserve the previous snapshot.

Compute capture returns `{ kind: 'error', reason: 'busy' }` while a snapshot is retained. Simulation commands preserve retained data. Matching release returns `ok`; missing or mismatched tokens return `stale`. Invalid offsets return `range`. Collection and file page failures use `stale` or `invalidOffset`, with `limit` and `exhausted` for capture failures. Tokens never wrap and replace live snapshots.

File capture calls `File.read_at` at offset zero with a 65537-byte read to detect files beyond the 65536-byte bound. Pages remain stable after capture. The read is not an atomic filesystem snapshot against concurrent external writes.

`collectSnapshot` reassembles pages and validates identity, total, offset, count, and completion. The caller supplies the result's total limit and page cap and releases the snapshot separately. The collector returns a `number[]`, including for file bytes.

## Stateful effects and ownership

The native application transition is $step : State \times Command \rightarrow IO(State \times Reply)$. Pure commands call pure helpers. Effectful commands retain or consume affine resources and return updated native state with a bounded reply.

One executable per application kind keeps unrelated affine state and resource tables separate. One process per session provides isolation and explicit cleanup. Bend owns computation and effects; Node owns HTTP and process lifecycle. Large results use pages while preserving the Phase 1 framing limit.

No Bend closure, native pointer, runtime type, or OS descriptor crosses HTTP. The external client receives an opaque resource ID. A resource table removes an affine handle, consumes it in an operation, and reinserts the returned handle when the operation supports recovery. Explicit close omits reinsertion.

The gateway admits one command per worker at a time. Competing commands return `TOO_MANY_REQUESTS`. A hard deadline returns `GATEWAY_TIMEOUT` and makes the worker terminal. Worker loss and protocol failures return `SERVICE_UNAVAILABLE`. Commands are never automatically replayed after an uncertain outcome. Tests distinguish application errors, effect failures, infrastructure failures, and effects whose reply was lost. An error does not imply rollback.

Idle shutdown consumes native state, explicitly closes resources, and acknowledges cleanup. Stalled workers have bounded forced termination. Concurrent close shares cleanup, and gateway shutdown waits for overlapping startups. Cleanup failures propagate.

For an idle application, native operation `3` with an empty payload invokes shutdown, replies `[0]`, and closes the transport. A nonempty shutdown payload receives `[255]` without closing the application. `terminationGraceMs` defaults to 100 milliseconds. Busy, stalled, failed, or unresponsive workers use forced termination. Node rejects commands as soon as close starts.

`IO.within` does not cancel the losing computation. A timeout does not return ownership held by that computation. Controlled channel handshakes prove task ordering, and external markers prove late effects and no replay. These are runtime observations, separate from pure-core proofs.

Task sessions immediately collect successful timeout acknowledgements, reap completed late acknowledgements between commands, and cap still-pending losing computations at 16. Graceful shutdown drains pending work, but forced termination does not promise completion of outstanding effects.

## Compiler and proof scope

Positive fixtures exercise affine resources and closures, erased parameters, templates, dependent structures, and concrete polymorphism. Negative fixtures check the intended diagnostic for duplicated affine values, invalid erased use, invalid templates or dependent inputs, computed matches, non-decreasing recursion, and missing or false laws.

The `--verdict` checks cover 15 compute laws for sort preservation and order, tree conversion, budgets, and simulation invariants. Ten numeric laws cover initial bounds, guarded accumulation, rejection preservation, untouched fields, reset, word-state bounds, and count exhaustion. The laws connect to production pure helpers rather than standalone example algorithms.

`tests/compiler/compute-laws.test.ts` and `tests/compiler/numeric-laws.test.ts` require `ALL PROOFS CHECK`, inspect translated law names, and reject missing or false laws for the intended diagnostics. The numeric proof covers the pure Nat transition invoked by production helpers; it does not prove native U32 conversions or all 48-bit Nat operations.

Pure proofs do not establish foreign C effects, framing, sockets, filesystem behavior, scheduling, or GPU execution. Those requirements have independent runtime fixtures. F32 values cross the wire as `U32` bits, including NaN, infinities, and signed zero, rather than JSON numbers.

## CUDA status

Production CPU-only and CUDA-linked compute variants build and pass independent CPU fallback references for sum, sort, 256 rendered pixels, and 512 sample bit patterns. The direct local CUDA build uses Clang `19.1.1` and CUDA `13.1`. CUDA-linked workers require CUDA shared libraries even with `--gpu off`.

On the current WSL2 host, `--gpu-build` exits zero without producing a matching `compute-worker-cuda.gpu`. Explicit `--gpu on` rejects the device because it lacks concurrent managed access. The probe reports `unavailable`; a required GPU run exits 1, and packaging fails. These observations establish compilation and fallback, not GPU execution or a deployable CUDA package.

Compute-only HTTP GPU admission is implemented. The gateway owner's `gpuEvidence` option or `BENDFLOW_GPU_EVIDENCE` selects a report validated against current source, host, toolchain, artifact hashes, and synchronized kernel diagnostics. Only verified evidence enables the GPU capability and worker selection. Unavailable or stale evidence rejects admission before spawn, with no silent fallback. Graphics and audio capabilities are excluded.

The remaining work is actual production CUDA execution on a compatible native Linux NVIDIA machine, synchronized device evidence, a matching artifact, and passing package and full completion checks.

### CUDA builds and artifacts

`scripts/build/cuda.ts` requires Linux x64, Node 24, a clean pinned Bend checkout, Clang 19 or newer, and a CUDA toolkit. `CUDA_CC` overrides `.toolchain/clang/usr/bin/clang-19`. `CUDA_HOME` or `CUDA_PATH` overrides the local `.toolchain/cuda` toolkit. The build accepts `SOURCE_ROOT OUTPUT_DIRECTORY` as two optional positional arguments and defaults to `build/cuda`.

| Output | Purpose |
| --- | --- |
| `compute-worker-cpu` | CPU-only executable built from `bend/compute-worker.bend` |
| `compute-worker-cuda` | CUDA-linked executable built from `bend/compute-gpu-worker.bend` |
| Matching `.c` files | Generated host code, with CUDA execution instrumentation in the CUDA variant |
| `build.json` | Toolchain, source fingerprint, commands, dependency observations, artifact hashes, and device-build outcome |
| `fallback.json` | Independent CPU-only and CUDA-linked fallback results |
| `profile.json` | Host, toolchain, environment, fixtures, commands, artifact hashes, and device execution outcome |
| `packaging.json` | Matching artifact and runtime-library checks |

Both executables must pass fallback with explicit `--gpu off` before the build command succeeds. The fixture checks a 32-item wrapping sum and sort, then seven simulation steps, a 256-pixel quadtree frame, and 512 sample bit patterns through pages.

The device artifact must be named `compute-worker-cuda.gpu` beside the CUDA executable. Its eight-byte runtime key must match runtime diagnostics, and its payload must begin with an ELF cubin header. Missing or stale artifacts, runtime device faults, changed hashes, and missing execution evidence fail verification. The artifact depends on device configuration; regenerate and verify the pair on each target runner.

The CUDA executable requires `libcuda.so.1` and `libnvrtc.so.12` or `libnvrtc.so.13`, even with GPU disabled. Deployment also requires the NVIDIA driver, NVRTC compiler dependencies, libc, and libm. Recorded `ldd` output identifies host dependencies. Keep the CPU-only variant available for hosts without CUDA libraries.

### Device evidence and completion policy

Instrumentation changes generated host C only; the pinned compiler checkout stays clean. The build rejects changed runtime hooks. After CUDA context creation and the managed-memory capability check, it records device name, driver version, and runtime artifact key. Successful `cuLaunchKernel` calls followed by `cuCtxSynchronize` increase a cumulative kernel counter reported at GPU evaluation completion.

Each sum, sort, rendering, and samples workload must produce a positive counter increment and match its independent reference. CPU fallback must produce no CUDA kernel evidence. The runner waits for complete diagnostics because TCP replies and stderr use separate streams. Counters cannot move backwards. They prove synchronized kernel execution, not speedup or useful-operation counts.

The runner first uses explicit GPU startup without an application port to check capability. On a usable device this intentionally reaches the worker's usage error and exits 1. It then starts a real worker through `NativeApp` for workload verification. The capability probe alone is not execution evidence. Worker command records retain `status: null` because the public API does not expose an exit code; protocol assertions and completed shutdown establish the outcome.

`scripts/conformance/hardware.ts` validates profile evidence against current source, host and kernel, the clean pinned compiler, Node, Bun, Bend, Clang, CUDA toolkit, fixtures, library resolution, artifact hashes, runtime key, and synchronized diagnostics. The source fingerprint covers `.bend` and `.ts` files under `bend`, `contracts`, `src`, and `scripts`. Source changes require a rebuild and fresh verification. Evidence is a local execution record, not an authenticated remote attestation.

The test reporter includes a separate hardware result from `build/cuda/profile.json` when present. Current verified hardware evidence can satisfy the GPU requirement while inventory rows retain their original status. The validator never fabricates passing GPU tests. Failed inventory test references still block completion. Full completion requires both portable test verification and current verified GPU evidence.

## Remaining CUDA acceptance

On a native Linux NVIDIA runner with concurrent managed access:

1. Reproduce portable setup and verification below.
2. Run `npm run setup:cuda` and `npm run build:cuda`.
3. Run `npm run conformance:cuda`, `npm run conformance:cuda:package`, and `npm run conformance:hardware`.
4. Configure the gateway with `gpuEvidence` or `BENDFLOW_GPU_EVIDENCE` and check compute-only GPU session admission with explicit `--gpu on`.
5. Run `npm test`, `npm run conformance:portable`, and `npm run conformance:full` to regenerate the report and require full acceptance.

Acceptance requires correct outputs and device evidence for all four workloads, a matching packaged artifact, and agreement between inventory, capabilities, and the executed report. Native window and audio exclusions remain explicit. The current WSL2 host cannot satisfy this requirement.

## Reproduction and completion checks

Run portable setup and checks from the repository root:

```sh
	npm ci
	npm run setup:bend
	npm run setup:clang
	npm run setup:lean
	npm run typecheck
	npm run check:compiler
	npm test
	npm run conformance:portable
```

The local Clang installer supports Ubuntu 24.04 x64; the Lean installer supports Linux x64 and verifies the official Lean 4.34.0 archive checksum. On other platforms, install matching tools directly. Build and test scripts select local tools through `PATH`. `CC` selects a different portable Clang. `LEAN_ARCHIVE` can supply an already-downloaded archive, which still must pass checksum validation.

CUDA setup and checks are separate:

```sh
	npm run setup:cuda
	npm run build:cuda
	npm run conformance:cuda:fallback
	npm run conformance:cuda:probe
	npm run conformance:cuda
	npm run conformance:cuda:package
	npm run conformance:hardware
	npm run conformance:full
```

The underlying `gpu.ts` modes are `fallback`, `probe`, `required`, and `package`, each with an optional output directory. For example, `npm run conformance:cuda:probe -- build/cuda` selects a directory. `probe` exits zero for verified or unavailable hardware and nonzero for a failure. `required` exits nonzero for anything except verified GPU execution. Package checks require matching current verified evidence.

Completion commands accept `--report PATH` for the executed-test report. Full completion also accepts `--hardware-report PATH` and defaults to `build/cuda/profile.json`. Portable completion requires every CPU and compiler requirement to have executed passing evidence. Pending requirements keep development reports in progress, and deleting required rows cannot make the report complete.

The setup, native and CUDA build, compiler-check, test-runner, and conformance scripts remain required for reproducible verification and evidence-gated GPU admission. Their package commands are defined in `package.json`; build outputs and machine-specific reports are ignored by Git.

## Sources

- [Bend language guide](https://github.com/bendlang/bend/blob/f0cf0a7c573145501981c44d9c33e326185f008e/guide/GUIDE.md)
- [Effects guide](https://github.com/bendlang/bend/blob/f0cf0a7c573145501981c44d9c33e326185f008e/guide/EFFECTS.md)
- [Base declarations](https://github.com/bendlang/bend/blob/f0cf0a7c573145501981c44d9c33e326185f008e/bend2/base.bend)
- [Runtime limits and intentional exclusions](https://github.com/bendlang/bend/blob/f0cf0a7c573145501981c44d9c33e326185f008e/WONTFIX.txt)
- [Upstream effect tests](https://github.com/bendlang/bend/tree/f0cf0a7c573145501981c44d9c33e326185f008e/tests/io)
- [Failed operations retain their handles](https://github.com/bendlang/bend/blob/f0cf0a7c573145501981c44d9c33e326185f008e/tests/io/fail_keeps_handle.bend)
- [Non-cancelling IO.within behavior](https://github.com/bendlang/bend/blob/f0cf0a7c573145501981c44d9c33e326185f008e/tests/io/within.bend)
