# Complete BendFlow Phase 2

Use this plan to finish the feature-conformance suite described in [the Phase 2 specification](bend-node-phase2.md). Complete each milestone's acceptance checks before treating that milestone as finished.

## Implementation progress

Phase 2 is at the feature-conformance expansion stage. The gateway and validation foundation is implemented. See [the recorded status](bend-node-phase2.md) and `build/phase2-results.json` for the last executed evidence.

- Milestone 1 has a validated feature inventory, required feature IDs, and an executed-test report. Capabilities distinguish available profiles from verified test results.
- Milestone 2 has strict contracts for every kind, primitive wire bounds, bounded native output errors, binary HTTP serialization, and strict Unicode validation. Complete codec vectors, nested structures, and paging remain pending.
- Milestone 3 has typed all-kind HTTP lifecycle routes and separate-client-process tests. The file path proves shared handles, failure recovery, independent filesystem observation, and close behavior.
- The resource-cleanup portion of milestone 5 has native shutdown acknowledgement and bounded forced fallback. The wider resource and networking conformance work remains pending.
- Milestones 4 through 9 retain their outstanding feature rows in the inventory. Hardware profiles include explicit prerequisites.

## Reconcile the recorded baseline with the working tree

The Phase 2 specification records 124 passed tests, 0 failures, and 0 skips. Its toolchain is Node `v24.11.0`, Bun `1.3.3`, Bend `2.0.40` at `f0cf0a7c573145501981c44d9c33e326185f008e`, and Ubuntu Clang `18.1.3`. Treat that run as historical evidence until the current working tree passes again.

The retained inventory has 77 feature rows: 40 marked verified, 34 pending, and 3 unavailable hardware rows. These counts describe inventory claims, not a fresh verification run or a percentage of implementation effort.

The working tree has reorganized scripts and tests:

- Native build code is in `scripts/build/native.ts` and `scripts/build/targets.ts`.
- Conformance code is in `scripts/conformance/`, including `requirements.ts`, `inventory.ts`, and `reporter.ts`.
- Tests are in `tests/unit/`, `tests/integration/`, `tests/compiler/`, and `tests/types/`.
- Application codecs have separate modules under `src/protocol/codecs/`.

The reorganization has an evidence-path blocker. `loadInventory()` expects `tests/conformance/coverage.json`, but only `tests/phase2/coverage.json` exists. Its references still use the old test paths. On November 15, 2026, this targeted check failed with `ENOENT`:

```sh
node --input-type=module -e 'import { loadInventory } from "./scripts/conformance/inventory.ts"; await loadInventory();'
```

The current architecture supports the remaining work:

- `src/gateway.ts` exposes all eight kinds through `startAppGateway`.
- `AppSessions` in `src/apps.ts` owns session admission, lookup, startup, and shutdown. Each `NativeApp` owns one native process.
- Contracts validate every kind. `src/protocol/codec.ts` validates encoded commands and decoded replies.
- `bend/loop.bend` shares the native lifecycle. Application handlers own state and explicit resource cleanup.
- Idle native shutdown acknowledges cleanup, with bounded forced termination for stalled workers.
- `/capabilities` reports CPU profiles as available. The conformance report establishes verified results separately.
- The wire policy remains a 256-byte frame body and a 248-byte payload. Default field limits are 96 UTF-8 bytes, 192 binary bytes, and 32 list items.

## 0. Restore a reproducible conformance baseline

1. Finish the inventory path migration to `tests/conformance/coverage.json` and update every test reference to the current file and exact test name.
2. Check documentation links and script paths against the reorganized tree.
3. Run the targeted inventory check above, `npm run test:unit`, `npx tsc --noEmit`, and `npm test`.
4. Confirm that the regenerated report verifies its referenced tests and remains `in-progress` because required features are pending.
5. Record the new test totals and toolchain. Preserve existing feature IDs and their declared scope.

Acceptance requires a fresh full-suite pass, valid evidence references, and a regenerated `build/phase2-results.json`. This milestone repairs evidence plumbing before new feature work.

## Keep the existing application architecture

Extend the current application-shaped workers. Each worker keeps its concrete state and fixed command union. Node supplies validation, HTTP routing, session ownership, deadlines, and bounded wire exchange.

For effectful applications, preserve the transition shape $step : State \times Command \rightarrow IO(State \times Reply)$. Keep pure algorithms separate so that the compiler and proof checks can verify them without foreign effects.

Two completion approaches were considered:

1. Extend the eight workers and their typed contracts under the existing gateway session owner.
2. Replace the workers with one universal native dispatcher containing every application's state and effect family.

Use the first approach. It fits the existing compiled applications, retains process isolation, and lets each milestone run independently. The universal dispatcher would couple unrelated resources and require a rewrite before adding evidence.

The implemented client flow is a typed create request, repeated typed commands addressed to the returned session ID, and an idempotent close request. Route commands by session kind and reject kind mismatches before dispatch. Keep session IDs separate from native resource IDs.

Give the gateway one owner for its session registry. Derive supported kinds, contract identifiers, and build targets from one registry where practical. Add checks where Node and Bend declarations must remain separate.

## 1. Define the feature inventory and completion rules

The feature inventory, required IDs, schema validation, and executed-test reporter already exist. Finish their completion rules:

1. Keep one row per intended feature or API behavior from sections 1 through 7 of the specification. Split broad rows when one passing test would conceal unfinished subfeatures.
2. Map each added command to its feature IDs, profile, exact tests, and independent evidence.
3. Add an explicit final completion check that rejects pending portable requirements. Ordinary development runs may remain `in-progress`.
4. Change `tests/unit/coverage.test.ts` to verify pending-status handling using controlled inventory inputs. Its current assertions require real paging and proof rows to stay pending, which would block completion.
5. Preserve checks for duplicate IDs, missing requirements, missing commands, nonexistent test files, and skipped or failed evidence.
6. Keep profile availability separate from verification. Connect hardware availability to configured prerequisites when hardware support is added.

Include every feature listed in later milestones before completing this inventory. Do not shrink the declared scope to match existing tests.

Acceptance requires that a missing feature row, nonexistent evidence reference, or unsupported verified-profile claim fails the coverage check. The portable completion report must have no pending required CPU or compiler rows.

## 2. Finish contracts and bounded serialization

Strict all-kind contracts, primitive bounds, binary HTTP serialization, raw file-read bounds, and strict Unicode validation are implemented.

1. Define limits for complete encoded commands and replies, including nested-field overhead. Individual fields fitting their limits does not prove that the whole payload fits.
2. Add page commands to the relevant application contracts and codecs. Keep the existing frame size.
3. Define offsets, page counts, completion markers, total-size limits, and stale-page errors. Use a retained snapshot or version check for mutable results.
4. Start with collection and file reassembly. Use the same page envelope for frames and samples when milestone 7 adds them.
5. Add explicit encodings and native round-trip tests for nested records, unions, optional values, lists, Unicode characters, arbitrary bytes, array contents, tuples, and resource IDs.
6. Add golden vectors and malformed-input cases for every codec. Cover unknown tags, truncation, trailing bytes, invalid UTF-8, exact limits, and one-over-limit values.
7. Audit new command bounds at Node and raw native entry points. Bound outputs before serialization, including the combined process output.
8. Add numeric cases for `Nat` zero and $2^{48}-1$, out-of-range rejection, `U32` wrapping versus checked accumulation, and native `F32` infinities, NaN, signed zero, and rounding.

Preserve the existing framing limit and use bounded chunks or pages for larger collections, files, frames, and samples. Define offsets, completion markers, ordering, and maximum total sizes. For mutable paged results, define a version or snapshot policy so that pages cannot silently combine different states.

Keep `F32` payloads as bits. Validate Unicode strictly, including malformed sequences whose replacement characters could preserve the original byte count. Keep error messages bounded and UTF-8-valid.

Acceptance requires cross-language agreement on the golden vectors and complete reassembly of results larger than one frame. Malformed requests must perform no effects. A supported result must decode successfully or return a defined bounded application error.

## 3. Expose all eight kinds through the HTTP gateway

Typed all-kind routes and external-client-process lifecycle tests are implemented. Retain this milestone as a regression gate for every expanded session:

1. Extend `tests/integration/gateway.test.ts` and the external client fixture as commands are added.
2. Drive each new effect family and its failure-recovery sequence through HTTP with independent observers.
3. Preserve one in-flight command per worker, bounded busy and deadline errors, and terminal worker-failure behavior.
4. Keep HTTP body limits consistent with serialized command policies. Map validation, application, effect, and infrastructure outcomes consistently.
5. Prove resource isolation and repeated use through separate clients and separate sessions.
6. Retain concurrent-close, startup-shutdown overlap, admission, and forced-cleanup regression tests.

Acceptance requires an external process to create, use repeatedly, and close every session kind through HTTP. Unknown sessions, kind mismatches, and malformed inputs must fail before native dispatch. Capabilities must list usable routes and their profiles accurately.

## 4. Complete numeric and collection conformance

1. Add the declared calculate, convert, compare, boolean, and bit-operation cases to numeric commands. Test every named operation against an independent mathematical or bit-level oracle.
2. Add nested records, tuple results, set operations, folds, and concrete polymorphic instantiations to collection commands.
3. Add named template specializations and higher-order helpers inside compiled handlers.
4. Store a closure in native state and consume it in a later command. Return a typed missing or consumed result on a second attempt.
5. Add a dependent structure, such as a sized collection, with an externally observable operation that requires its invariant.
6. Exercise `Maybe` and `Result` monadic success and short-circuit behavior.
7. Extend persistent array tests to include capacity, index wrapping as defined by Base, empty inputs, duplicate values, maximum lists, and multiple sessions.
8. Verify sorting at the maximum supported list size. Tie its termination fuel to the supported bound so that a larger input cannot silently discard values.

Acceptance requires each language feature to have a command or compiler-only fixture that actually uses it. Stateful sequences must preserve unrelated collection state. Sorting must preserve the input multiset and return ordered output.

## 5. Complete affine resources, networking, and failure semantics

1. Add append-mode, empty-file, EOF, binary, Unicode-text, multiple-handle, and maximum-chunk file tests. Check the real file after every relevant operation.
2. Test resource isolation, closed IDs, multiple simultaneously retained resources, and ID exhaustion. Prevent ID wraparound from replacing a live handle.
3. Add persistent TCP listeners, accept, polling, and timed operations supported by the pinned Base library. Retain listener ownership across requests and close listeners explicitly.
4. Replace the current one-write TCP fixture with controlled fragmented writes. Add half-close, refused connection, peer reset, EOF, and recovery cases.
5. Use a peer that delays reads to exercise backpressure. Preserve or report unsent data from send failures where Base returns it, and verify partial-completion behavior.
6. Extend UDP tests to assert sender host and port, zero-length datagrams, maximum datagrams, timeout followed by success, malformed addresses, and resource closure.
7. Prove native shutdown closes retained resources on a graceful close and transport disconnect. Use peer EOF, released listener ports, or an observed native cleanup effect as evidence.
8. Add effectful uncertain-completion tests. Let a fixture observe a write or marker, withhold its reply, and verify that neither Node nor the gateway replays the operation.

Extend the existing graceful-shutdown exchange to each new resource type. Audit `NativeApp.close`, `BendWorker.close`, and the native shutdown operation together. Process reaping alone does not prove that native cleanup callbacks ran. Retain forced termination for stalled or failed workers.

Acceptance requires successful, failed, timed, and closed-resource sequences through HTTP. Recovery must retain ownership where Base supports it. Distinguish a confirmed application result from an effect failure and an uncertain infrastructure outcome. Never claim that an error rolled back an external effect.

## 6. Complete tasks, process fixtures, and custom C effects

1. Add explicit `IO.spawn`, channel send, receive, and close commands or compiled scenarios. Use controlled handshakes to prove ordering and completion.
2. Transfer an affine resource into a background job and collect it back in the job result. Prove that the foreground state cannot reuse the resource while the job owns it.
3. Cover multiple jobs, join exactly once, missing jobs, completion before join, timeout before completion, and shutdown with outstanding work.
4. Keep the `IO.within` late-effect test. Add success-before-deadline coverage and a valid command after timeout.
5. Replace sleep-only ordering checks with fixture acknowledgements where possible. Use the existing `tests/support/` cleanup helpers and let cleanup failures fail tests.
6. Build a fixed process fixture that reports exact arguments, stdin, stdout, stderr, and requested exit status. Select named fixture behaviors through commands.
7. Cover launch failure, timeout, combined output-limit failure, missing environment variables, and arguments after runtime-option filtering. Verify recovery with a later valid command.
8. Validate random results as `U32` values. Avoid tests that assume two random draws must differ.
9. Extend custom effects with returned constructors, an immediate result, helper-thread work, and parked IO. Use the pinned effects guide and upstream examples for registration and completion conventions.
10. Test custom-effect failure followed by success, repeated retained results, and independent sessions. Verify exact external changes and complete writes.

Keep ownership inside the job until completion. `IO.within` does not cancel its losing computation. Define what graceful shutdown does with jobs and late effects, and bound the wait before forced termination.

Acceptance requires externally observed process input and output, handshake-proven channel behavior, and a real fixture for each custom-effect execution path. Cleanup failures must fail tests rather than disappear in teardown.

## 7. Complete parallel compute, stateful rendering, and samples

1. Replace the current unbalanced sum with a structurally decreasing balanced workload. Use a tree or sized representation that gives both parallel branches comparable work.
2. Add parallel sorting and a stateful simulation with advance, inspect, and reset commands.
3. Render deterministic frames from simulation state. Exercise the declared event-processing behavior and compare pixels against an independent reference.
4. Add pure sample synthesis with deterministic sample count, values, and numeric tolerances. Exercise larger frames and sample buffers through bounded pages.
5. Run the same algorithms with one, two, and four CPU threads, plus a supported host configuration where useful. Verify thread-count reports for each run.
6. Compare all outputs with independent references and test boundaries, repeated steps, reset, and isolation.

Acceptance requires equivalent algorithm results across CPU configurations and observable state changes across requests. Thread-count reporting proves configuration, not balanced work or speedup. No performance claim is required to finish Phase 2.

## 8. Finish compiler and proof coverage

1. Add positive fixtures for affine arrays, handles, closures, erased parameters, templates, dependent structures, and concrete polymorphism.
2. Pair them with expected failures for array, handle, and closure duplication, invalid template arguments, incorrect dependent inputs, and missing or false laws.
3. Keep existing termination, computed-match, erased-binder, and affine-state rejection cases.
4. Assert the relevant diagnostic and failure outcome. A parse error or missing import must not count as the intended rejection.
5. State laws for the selected pure computational core, including sort preservation and order, bounded numeric state behavior, and simulation invariants.
6. Keep claims and proofs separate. Use `--verdict` for the pure proof fixtures supported by the pinned compiler, and record the kernel result.
7. Register positive checks and proof targets in `scripts/build/targets.ts` or a dedicated compiler-check command. Map each fixture into the coverage inventory.

Acceptance requires positive fixtures to pass and their invalid counterparts to fail for the intended reason. Pure laws must pass the configured proof gate. Report foreign-effect workers separately because proofs do not establish C-effect or wire correctness.

## 9. Implement and verify hardware profiles

Start arranging suitable machines and fixtures after milestone 0, while portable features are implemented. Hardware availability can otherwise delay the final phase.

1. Add actual GPU-marked computations and the build support for their native GPU artifacts. Retain the artifacts beside the executable as required by Bend.
2. Select runtime arguments using the pinned compiler's documented options and help output. Verify the existing GPU argument policy rather than assuming `--gpu on` is supported.
3. Run deterministic sum, simulation, or rendering cases on a configured Metal or CUDA host. Record device and runtime instrumentation that establishes actual GPU execution.
4. Test CPU fallback separately. Correct output from a fallback run must not verify the GPU profile.
5. Add native `Window` lifecycle and event tests against a configured display fixture. Observe a presented frame, event delivery, and close behavior externally.
6. Add native `Audio` lifecycle and sample-output tests against an audio capture fixture. Verify captured samples and resource cleanup.
7. Store profile results with the host, toolchain, commands, instrumentation, and fixture configuration. Feed these results into the completion report and capabilities configuration.

Acceptance requires observed GPU execution, observed window effects, and observed audio effects on their configured hosts. On a host without these prerequisites, return `unavailable` with a reason and setup instructions. Never report an unavailable run as passed or silently skip a requested available profile.

The specification permits unavailable profiles in a portable completion report. Mark full all-profile verification only after the hardware checks pass on suitable hosts.

Track missing hardware implementation separately from missing hardware access. The current unavailable rows also name missing kernels and native Window and Audio commands. Add those commands and build targets before claiming that only host verification remains.

## 10. Run the final conformance check and update the status

1. Run `npx tsc --noEmit` and `npm test` after the portable implementation is complete.
2. Run the profile-specific checks added in milestone 9 on their configured hosts.
3. Validate the feature inventory against executed results. Require every declared supported feature to have evidence and every effect family to have independent observation.
4. Require the expanded tests to pass alongside the existing Phase 1 protocol, lifecycle, and no-replay tests.
5. Update `docs/bend-node-phase2.md` with the verified scope, remaining unavailable environments, and actual commands.
6. Update `README.md` with all-session gateway usage and links to the protocol, profile setup, and conformance report.
7. Publish one completion artifact with feature results, toolchain revision, profile results, and external fixture evidence.

Add a full all-profile completion outcome only when GPU, window, and audio feature evidence has passed. The current reporter emits `portable-complete`; extend the report deliberately rather than treating that value as all-profile completion.

Keep hardware setup commands and hardware verification commands separate from the required portable test command. A host with configured hardware must fail a requested profile run when that profile is broken.

## Schedule by dependencies

Two schedules are viable: complete all native handlers before adding their evidence, or deliver one feature family with contracts, native code, HTTP tests, compiler fixtures, and inventory updates. Use the second schedule. Each unit ends with observable evidence and avoids a final integration backlog.

Execute in this order:

1. Restore the baseline and finish completion rules in milestones 0 and 1.
2. Implement paging and codec vectors in milestone 2. Verify collection and file page reassembly first.
3. Complete numeric and collection features in milestone 4, with milestone 3 HTTP checks and milestone 8 compiler fixtures for each addition.
4. Complete file and network conformance in milestone 5. Prove effectful no-replay early, before expanding background effects.
5. Complete tasks, processes, and custom effects in milestone 6. Their work can proceed independently once shared protocol policies pass.
6. Complete balanced compute, simulation, rendering, and samples in milestone 7. Finish frame and sample paging evidence here.
7. Finish the pure-core proof gate in milestone 8 after algorithms settle.
8. Finish hardware implementation and observed verification in milestone 9 on configured hosts.
9. Run milestone 10 and publish the completion outcome.

Prepare hardware hosts during steps 2 through 7. Hardware tests depend on the compute commands, resource lifecycle, and build support. Full all-profile completion depends on those tests passing.

The immediate implementation slice is milestone 0, followed by bounded collection and file paging. Prove exact page reassembly, empty and final pages, invalid offsets, maximum totals, and mutation between page requests.

## Track the remaining feature IDs

Use these groups to select work after the baseline is restored. Revalidate the inventory after each completed unit.

| Work unit | Outstanding feature IDs | Required acceptance evidence |
| --- | --- | --- |
| Protocol, milestone 2 | `protocol.full-codec-vectors`, `protocol.nested-encodings`, `protocol.paging` | Node and Bend agree on bytes. Large results reassemble without mixed versions. Raw malformed input has no effects. |
| Numeric, milestone 4 | `numeric.reset`, `numeric.full-operation-set`, `numeric.native-boundaries` | Independent arithmetic and bit-level oracles, native float-bit expectations, and failure followed by valid stateful commands. |
| Collection, milestone 4 | `collection.nested-records-tuples`, `collection.sets-folds`, `collection.templates-polymorphism`, `collection.affine-closures`, `collection.dependent-structures`, `collection.monads`, `collection.boundaries` | Real compiled language-feature use, exactly-once closure consumption, dependent invariants, and maximum-size sort order and multiset preservation. |
| Files, milestone 5 | `file.append-eof-text`, `file.resource-isolation` | Exact filesystem bytes, EOF behavior, retained multiple handles, isolation, and safe resource-ID exhaustion. |
| Network, milestone 5 | `network.listeners-polling`, `network.controlled-fragmentation`, `network.backpressure-failures`, `network.udp-boundaries` | Controlled TCP writes and peer failures, ownership recovery, UDP sender metadata, timeout recovery, and externally observed cleanup. |
| Tasks, milestone 6 | `task.nap`, `task.channels-spawn`, `task.resource-transfer`, `task.lifecycle-boundaries` | Channel handshakes, affine ownership transfer and return, exactly-once join, and bounded shutdown with outstanding work. |
| Processes, milestone 6 | `process.full-fixture` | Exact arguments, stdin, stdout, stderr, and exit status, plus launch, timeout, and combined-output failures followed by recovery. |
| Custom effects, milestone 6 | `custom.execution-paths`, `custom.failure-persistence` | Immediate, helper-thread, and parked-IO fixtures, returned constructors, complete external writes, recovery, and isolation. |
| Compute, milestone 7 | `compute.balanced-sum-sort`, `compute.simulation-events-rendering`, `compute.samples` | Independent references across one, two, and four threads, state transitions, deterministic pixels and samples, and paged reassembly. |
| HTTP effects, milestones 3, 5, and 6 | `gateway.effectful-no-replay`, `gateway.effect-families` | A fixture observes an effect whose reply is lost. The effect count stays one. Each effect family has an HTTP success and applicable failure sequence. |
| Compiler, milestone 8 | `compiler.affine-resources`, `compiler.templates-dependent-inputs`, `compiler.laws-verdict` | Positive fixtures pass, negative fixtures fail for the intended diagnostic, and pure-core laws pass `--verdict`. |
| Hardware, milestone 9 | `hardware.gpu`, `hardware.window`, `hardware.audio`, currently unavailable | Device execution instrumentation, captured window presentation and events, captured audio, and explicit cleanup evidence. |

For each unit, update the contract, codec, native handler, relevant tests, and feature evidence together. Preserve existing Phase 1 and Phase 2 regression coverage. A feature becomes verified only after its referenced test actually passes.

## Use these final completion criteria

- All eight session kinds support typed external-client lifecycle tests.
- Every intended portable computation and compiler feature has verified evidence.
- Every effect family has externally observed success and applicable failure behavior.
- Resources persist across requests, recover where supported, remain isolated, and close explicitly on graceful shutdown.
- Malformed input and oversized output follow documented bounded policies.
- Larger supported results survive complete chunk or page reassembly.
- Uncertain effects are never automatically replayed.
- Parallel algorithms return correct results across the supported CPU thread configurations.
- GPU, window, and audio claims have execution evidence, or appear explicitly as unavailable in the portable report.
- The coverage inventory, capability endpoint, documentation, and executed result report agree.

Portable completion requires every required native-CPU, multithreaded-CPU, and compiler feature to be verified. Hardware rows may remain unavailable with concrete reasons in that report. Completing the entire all-profile Phase 2 additionally requires verified GPU, window, and audio evidence.

The recorded 124-test pass establishes the previous foundation. Completion depends on expanded feature evidence and a fresh passing report, not a target test count.
