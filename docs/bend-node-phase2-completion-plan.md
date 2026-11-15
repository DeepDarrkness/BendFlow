# Complete BendFlow Phase 2

Use this plan to finish the feature-conformance suite described in [the Phase 2 specification](bend-node-phase2.md). Complete each milestone's acceptance checks before treating that milestone as finished.

## Implementation progress

The first foundation slice is implemented. See [the current status](bend-node-phase2.md) and `build/phase2-results.json` for executed evidence.

- Milestone 1 has a validated feature inventory, required feature IDs, and an executed-test report. Capabilities distinguish available profiles from verified test results.
- Milestone 2 has strict contracts for every kind, primitive wire bounds, bounded native output errors, binary HTTP serialization, and strict Unicode validation. Complete codec vectors, nested structures, and paging remain pending.
- Milestone 3 has typed all-kind HTTP lifecycle routes and separate-client-process tests. The file path proves shared handles, failure recovery, independent filesystem observation, and close behavior.
- The resource-cleanup portion of milestone 5 has native shutdown acknowledgement and bounded forced fallback. The wider resource and networking conformance work remains pending.
- Milestones 4 through 9 retain their outstanding feature rows in the inventory. Hardware profiles include explicit prerequisites.

The baseline below records the initial audit before this implementation slice.

## Start from the verified baseline

The repository has working native examples for all eight session kinds. Phase 2 is at the baseline-conformance stage. It still needs complete gateway access, feature-level evidence, broader failure coverage, and hardware-profile verification.

On November 15, 2026, these commands succeeded:

```sh
npx tsc --noEmit
npm test
```

The test run rebuilt the native executables and reported 98 passed, 0 failed, and 0 skipped. The toolchain was Node `v24.11.0`, Bun `1.3.3`, Bend `2.0.40` at `f0cf0a7c573145501981c44d9c33e326185f008e`, and Ubuntu Clang `18.1.3`.

Use the following implementation facts when scheduling the remaining work:

- `NativeApp` in `src/app.ts` connects typed commands to `BendWorker`. Each application instance owns one process.
- `bend/loop.bend` shares the handshake, dispatch, and connection loop. Application handlers own native state and resource cleanup.
- Numeric, collection, and file commands have Zod contracts. Network, task, process, compute, and custom codecs currently cast their inputs instead of validating them.
- `src/gateway.ts` exposes only `startNumericGateway`. The other seven session kinds run through `NativeApp` in their tests, not through public HTTP endpoints.
- File tests demonstrate handle persistence, recovery after a failed read, and externally observed offset writes. Network tests cover a client TCP exchange and a UDP exchange.
- Task tests cover fork, join, and the late effect after an `IO.within` timeout. They do not cover explicit channel protocols or resource transfer.
- Compute has an idle state, a sum, thread-count reporting, and four constant `Image` pixels. Its recursive sum forks a tiny addition against the remaining list, rather than two balanced workloads.
- Custom-effect coverage observes one synchronous C marker write. Process coverage checks environment, worker arguments, echo output, an `ls` failure, and a random reply tag.
- Compiler tests cover affine numeric-state duplication, computed matches, non-decreasing recursion, erased-binder use, and a positive codec check.
- `tests/phase2/coverage.json` has one row per session. Its test checks names and nonempty evidence strings, not every intended feature or test reference.
- The inventory records four-thread CPU verification. The default capabilities endpoint nevertheless reports multithreaded CPU as unavailable unless an availability flag is supplied.
- The current wire limits remain a 256-byte frame body and a 248-byte payload. Field defaults are 96 UTF-8 bytes, 192 binary bytes, and 32 list items.

Correct the original document's statements that eight kinds already run through the gateway and that collections plus file handles are the next slice. Those statements no longer match the implementation.

## Keep the existing application architecture

Extend the current application-shaped workers. Each worker keeps its concrete state and fixed command union. Node supplies validation, HTTP routing, session ownership, deadlines, and bounded wire exchange.

For effectful applications, preserve the transition shape $step : State \times Command \rightarrow IO(State \times Reply)$. Keep pure algorithms separate so that the compiler and proof checks can verify them without foreign effects.

Two completion approaches were considered:

1. Extend the eight workers, add typed contracts, and put their lifecycle behind one gateway session owner.
2. Replace the workers with one universal native dispatcher containing every application's state and effect family.

Use the first approach. It fits the existing compiled applications, retains process isolation, and lets each milestone run independently. The universal dispatcher would couple unrelated resources and require a rewrite before adding evidence.

The proposed client flow is a typed create request, repeated typed commands addressed to the returned session ID, and an idempotent close request. Route commands by session kind and reject kind mismatches before dispatch. Keep session IDs separate from native resource IDs.

Give the gateway one owner for its session registry. Derive supported kinds, contract identifiers, and build targets from one registry where practical. Add checks where Node and Bend declarations must remain separate.

## 1. Define the feature inventory and completion rules

1. Expand `tests/phase2/coverage.json` into one row per intended feature or API behavior from sections 1 through 7 of the specification.
2. Give each row a stable feature ID, session kind or compiler-only category, command, profile, status, test reference, and independent evidence description.
3. Use statuses that distinguish pending work, verified behavior, and unavailable environments. Give unavailable rows a concrete prerequisite and reason.
4. Validate the inventory with a schema. Check duplicate IDs, test-file existence, command coverage, and supported profile names.
5. Make the conformance run produce a result artifact linking executed test IDs to feature IDs, profile configuration, and toolchain revision.
6. Make `/capabilities` use actual configured and verified profiles. A caller-supplied boolean alone must not establish verification.

Include every feature listed in later milestones before completing this inventory. Do not shrink the declared scope to match existing tests.

Acceptance requires that a missing feature row, nonexistent evidence reference, or unsupported verified-profile claim fails the coverage check. The portable completion report must have no pending required CPU or compiler rows.

## 2. Finish contracts and bounded serialization

1. Add `contracts/network.ts`, `contracts/task.ts`, `contracts/process.ts`, `contracts/compute.ts`, and `contracts/custom.ts`. Derive command and reply types from their schemas.
2. Replace unchecked codec casts in `src/protocol/apps.ts` with boundary parsing. Validate replies against the corresponding contracts.
3. Define limits for complete encoded commands and replies, including nested-field overhead. Individual fields fitting their limits does not prove that the whole payload fits.
4. Validate read sizes, time limits, ports, resource IDs, collection counts, and output bounds at both external entry points. Raw native requests must receive bounded rejection too.
5. Bound native outputs before serialization. File reads currently accept arbitrary `U32` maxima, while process and environment results can exceed the Node text decoder's limit.
6. Add explicit encodings and native round-trip tests for nested records, unions, optional values, lists, Unicode characters, arbitrary bytes, array contents, and resource IDs.
7. Add golden vectors and malformed-input cases for every codec. Cover unknown tags, truncation, trailing bytes, invalid UTF-8, exact limits, and one-over-limit values.
8. Add numeric cases for `Nat` zero and $2^{48}-1$, out-of-range rejection, `U32` wrapping versus checked accumulation, and native `F32` infinities, NaN, signed zero, and rounding.

Preserve the existing framing limit and use bounded chunks or pages for larger collections, files, frames, and samples. Define offsets, completion markers, ordering, and maximum total sizes. For mutable paged results, define a version or snapshot policy so that pages cannot silently combine different states.

Keep `F32` payloads as bits. Validate Unicode strictly, including malformed sequences whose replacement characters could preserve the original byte count. Keep error messages bounded and UTF-8-valid.

Acceptance requires cross-language agreement on the golden vectors and complete reassembly of results larger than one frame. Malformed requests must perform no effects. A supported result must decode successfully or return a defined bounded application error.

## 3. Expose all eight kinds through the HTTP gateway

1. Add typed create, command, and close routes for all session kinds. Put session lookup and lifecycle ownership in one module, such as `src/apps.ts`.
2. Register each worker executable and codec with its kind. Start one process per created session.
3. Preserve one in-flight command per worker, bounded busy and deadline errors, and terminal worker-failure behavior.
4. Apply HTTP body limits that agree with the serialized command policies. Map validation, application, effect, and infrastructure outcomes consistently.
5. Add external-client-process tests for each kind. Use separate client processes to share a session and separate sessions to prove isolation.
6. Close all sessions during gateway shutdown and prove that concurrent close calls converge on the same cleanup result.

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

Audit `NativeApp.close`, `BendWorker.close`, and the native shutdown operation together. The current Node close path destroys the socket and signals the worker. Process reaping alone does not prove that native cleanup callbacks ran. Give idle sessions a bounded graceful-shutdown exchange, then retain forced termination for stalled or failed workers.

Acceptance requires successful, failed, timed, and closed-resource sequences through HTTP. Recovery must retain ownership where Base supports it. Distinguish a confirmed application result from an effect failure and an uncertain infrastructure outcome. Never claim that an error rolled back an external effect.

## 6. Complete tasks, process fixtures, and custom C effects

1. Add explicit `IO.spawn`, channel send, receive, and close commands or compiled scenarios. Use controlled handshakes to prove ordering and completion.
2. Transfer an affine resource into a background job and collect it back in the job result. Prove that the foreground state cannot reuse the resource while the job owns it.
3. Cover multiple jobs, join exactly once, missing jobs, completion before join, timeout before completion, and shutdown with outstanding work.
4. Keep the `IO.within` late-effect test. Add success-before-deadline coverage and a valid command after timeout.
5. Replace sleep-only ordering checks with fixture acknowledgements where possible. Remove the swallowed process-cleanup failure in `tests/phase2/task.test.ts`.
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
7. Register positive checks and proof targets in `scripts/build-native.ts` or a dedicated compiler-check command. Map each fixture into the coverage inventory.

Acceptance requires positive fixtures to pass and their invalid counterparts to fail for the intended reason. Pure laws must pass the configured proof gate. Report foreign-effect workers separately because proofs do not establish C-effect or wire correctness.

## 9. Implement and verify hardware profiles

Start arranging suitable machines and fixtures while milestones 1 through 3 are in progress. Hardware availability can otherwise delay the final phase.

1. Add actual GPU-marked computations and the build support for their native GPU artifacts. Retain the artifacts beside the executable as required by Bend.
2. Select runtime arguments using the pinned compiler's documented options and help output. Verify the existing GPU argument policy rather than assuming `--gpu on` is supported.
3. Run deterministic sum, simulation, or rendering cases on a configured Metal or CUDA host. Record device and runtime instrumentation that establishes actual GPU execution.
4. Test CPU fallback separately. Correct output from a fallback run must not verify the GPU profile.
5. Add native `Window` lifecycle and event tests against a configured display fixture. Observe a presented frame, event delivery, and close behavior externally.
6. Add native `Audio` lifecycle and sample-output tests against an audio capture fixture. Verify captured samples and resource cleanup.
7. Store profile results with the host, toolchain, commands, instrumentation, and fixture configuration. Feed these results into the completion report and capabilities configuration.

Acceptance requires observed GPU execution, observed window effects, and observed audio effects on their configured hosts. On a host without these prerequisites, return `unavailable` with a reason and setup instructions. Never report an unavailable run as passed or silently skip a requested available profile.

The specification permits unavailable profiles in a portable completion report. Mark full all-profile verification only after the hardware checks pass on suitable hosts.

## 10. Run the final conformance check and update the status

1. Run `npx tsc --noEmit` and `npm test` after the portable implementation is complete.
2. Run the profile-specific checks added in milestone 9 on their configured hosts.
3. Validate the feature inventory against executed results. Require every declared supported feature to have evidence and every effect family to have independent observation.
4. Require the expanded tests to pass alongside the existing Phase 1 protocol, lifecycle, and no-replay tests.
5. Update `docs/bend-node-phase2.md` with the verified scope, remaining unavailable environments, and actual commands.
6. Update `README.md` with all-session gateway usage and links to the protocol, profile setup, and conformance report.
7. Publish one completion artifact with feature results, toolchain revision, profile results, and external fixture evidence.

Keep hardware setup commands and hardware verification commands separate from the required portable test command. A host with configured hardware must fail a requested profile run when that profile is broken.

## Schedule by dependencies

Complete milestone 1 first. Complete milestones 2 and 3 before expanding effectful gateway coverage.

After the common contracts, protocol, and gateway work passes, milestones 4, 5, and 6 can proceed independently. Milestone 7 depends on the collection representations and paging policies. Add milestone 8 fixtures alongside each feature, then run its complete proof gate after the pure algorithms settle.

Prepare hardware fixtures early. Finish milestone 9 after the relevant compute and resource commands exist. Milestone 10 depends on all portable milestones and the explicit outcome of each hardware profile.

The immediate implementation slice is milestones 1 and 2 followed by a file-session HTTP path in milestone 3. Prove create, open, write, independently read, fail, recover, and close from an external client process. Then extend that lifecycle to the remaining kinds.

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

Passing the current 98 tests establishes the starting point. Completion depends on this expanded feature evidence, not a target test count.
