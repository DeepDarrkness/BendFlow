# BendFlow Phase 4: typed outcomes and standalone Node packaging

## Status

**First implementation pass complete in an isolated worktree; review fixes and integration outstanding.** The owner approved typed outcomes and diagnostics, standalone Node packaging, opt-in CPU auto-configuration, CPU-first release scope, stateless host-owned workers, and a 1 MiB payload policy on November 17, 2026. Phase 4 is not complete or production-ready. Implementation paused at the owner's request before the review-fix pass.

Phase 4 makes Bend-defined outcomes visible through generated connectors, structured logs, and OpenAPI descriptions. It packages BendFlow for use from an unrelated Node project. The [completed Phase 3 generator](bend-node-phase3.md) remains the implementation baseline for extraction, codecs, execution sessions, and native CPU execution.

### Implementation checkpoint

The uncommitted implementation is preserved at `/tmp/opencode/bendflow-phase4`, based on commit `0129fa2`. It has not been integrated into the main workspace. The main workspace contains this status update and the [implementation design](phase4-design.md). Do not remove the worktree as temporary data: it contains the only copy of the implementation changes.

The first pass implements argument-only generated calls, host-owned serialized workers, bounded encoded-byte queues, fresh-call recovery after fatal active failure, version-2 frames, U32 text and List lengths, and the 1 MiB native payload policy. It also implements Base Result/Maybe support, distinct native boundary failures, detached failure logging, generated OpenAPI, CPU auto-configuration, compiled package exports, an offline compiler-resource cache, and a Node-to-C/Clang consumer build path. These are implemented behaviors with the review gaps below, not a completion claim.

### Recorded verification

The implementation delegate reported these results before review. The lead inspected the worktree source, its test-results file, package evidence, and consumer scripts. The lead did not rerun the full implementation suite or integrate the code before the pause.

| Command or check | Recorded result |
| --- | --- |
| Baseline main-workspace `npm run test:unit` | 58 passed; no failures or skips; run directly by the lead before implementation |
| Worktree `npm test` | 323 tests: 322 passed, one skipped, zero failed; package-consumer gate also passed |
| Worktree `npm run check:compiler` | Compiler fixtures and proof checks passed |
| Worktree `npm run example` and `npm run example:session` | Both legacy examples passed |
| Worktree `node scripts/test/package-consumer.ts` | Actual tarball, offline consumer installation, CLI and build API, exact types, relocation, and runtime without build tools passed |
| Worktree `git diff --check` | Passed; also checked directly by the lead |

The skipped test requires the existing WSL CUDA-linked probe. This is not evidence of generated GPU support. The recorded payload regression returns 1,048,571 String bytes plus a four-byte length and one-byte connector tag, exactly filling the 1,048,576-byte payload. Lists with 300 items and Unicode/BOM preservation also passed in the reported run.

Evidence is preserved in the worktree's `build/phase2-results.json` and `/tmp/opencode/bendflow-package-evidence/result.json`. The latter records the tarball, offline consumer, and native-linkage evidence. Tested native artifacts link `libc.so.6` and `libm.so.6`, require GLIBC 2.38, and do not link CUDA. A green recorded run does not resolve the later review findings.

### Outstanding issues

Paths in this list refer to the implementation worktree, not the still-unmodified main-workspace code.

1. **CPU auto path traversal can fail to terminate.** `src/service-cpu.ts:33-41` can resolve a namespaced membership outside its mount and repeatedly visit `/`. A read-only review probe reproduced this with membership `/../../outside` and mount root `/tenant`. Constrain traversal to the mapped mount and stop at the filesystem root. Add a regression without losing valid ancestor quotas. Priority: P1.
2. **Startup waits delay abort and deadline rejection.** `src/service-host.ts:145-156` waits for shared acquisition before checking the caller's signal and waiting deadline. A deferred-start review probe remained pending after both. Race the caller's wait against cancellation and expiry, release that caller's admission reservation promptly, and keep shared startup host-owned. Priority: P2.
3. **Idle worker death loses the next fresh call.** `src/service-host.ts:122-140` can return an idle slot whose worker has already died. The next call fails before retirement enables recovery. Observe worker availability or death and retire idle failed workers before dispatch. Never retry a dispatched invocation. Add idle-death recovery coverage. Priority: P2.
4. **Some malformed-input tests still use one-byte prefixes.** Vectors in `tests/integration/general-services.test.ts` and `tests/integration/data-boundary.test.ts` fail at their outdated length prefix instead of reaching the intended Boolean, UTF-8, trailing-byte, or nested Char check. Replace prefixes with independent U32BE vectors and preserve the no-effect assertions. Priority: P2.
5. **Compiler cache defaults depend on the agent environment.** `scripts/build/toolchain-resources.ts:17` defaults to `/tmp/opencode/bendflow-compiler-cache`. Replace it with a normal user-cache location, retain an explicit override, and reject cache locations under `node_modules`, including symlink resolution. Verify bundled-resource prerequisites and cache-path diagnostics.
6. **Installed CLI defaults and configuration need completion.** `scripts/build/services.ts:123-140` defaults to repository example/output paths that are absent from the installed package. Require consumer entry/output arguments, expose per-service configuration and supported complexity-limit flags, and export a named public build-options type. Resolve relative `CC` against the consumer's working directory. These are source-review findings; fixes are not verified.
7. **Failure observation does not cover every owning stage.** `src/service-host.ts` observes dispatched failures, but validation, admission, acquisition, and waiting rejection need correlated, exactly-once failure events too. Include the boundary stage and execution certainty without raw arguments. Preserve detached redaction and logger-failure isolation. This is a source-review finding; the completion criterion remains unmet.
8. **Output replacement is not crash-atomic.** The existing two-rename publication sequence can leave output absent and a preceding package at its backup after interruption. An abandoned `.build-lock` can require explicit cleanup. Ordinary build-failure preservation and concurrent live-builder rejection passed, but crash recovery remains a documented limitation. Do not delete backup generations that may still be in use.

The final scoped comment review, main-workspace integration, regression rerun, package-consumer rerun, and architecture/usage documentation updates also remain outstanding. The fix delegate was cancelled before returning changes; no review issue is marked resolved.

### Resume order

1. Inspect the preserved worktree and its uncommitted diff. Keep existing unrelated main-workspace research documents intact.
2. Fix the CPU traversal defect, startup cancellation/deadlines, idle recovery, and malformed vectors with behavioral regressions.
3. Complete cache, CLI, staged diagnostics, and failure-observation requirements. Decide or explicitly retain the documented crash-publication limitation.
4. Run targeted checks, the full suite, compiler/proof checks, and the actual package-consumer gate from the corrected worktree.
5. Review and integrate the verified changes into the main workspace, rerun the affected gates there, and update completion status from those observed results.

The permanent worktree script `scripts/test/package-consumer.ts` recreates its disposable consumer probes. The session's `build-api.mjs`, `runtime.mjs`, and `typed.ts` probes were removed from `/tmp/opencode/bendflow-package-evidence/consumer` after their purpose and ownership were checked. Implementation source, test drivers, tarballs, and verification reports remain preserved. DB connectors and generated GPU execution remain deferred.

## Scope

Implement these outcomes without changing Bend's compiler or runtime internals:

- Support Base Result and Maybe at supported boundaries, including nested, imported, and closed-alias forms.
- Preserve custom Data records and unions as Bend-defined success and error values.
- Log validated error values in Node with invocation context.
- Generate OpenAPI descriptions from the same extracted shapes that define endpoint contracts and codecs.
- Distinguish request rejection from response-encoding failure in the native protocol.
- Report build failures with their stage, source location where available, and useful compiler diagnostics.
- Publish compiled Node package exports, a build CLI, and relocatable generated service artifacts.
- Detect deployment CPU availability for an explicit `worker.threads: "auto"` option, with numeric overrides and the retained two-thread default.
- Qualify CPU-only native artifacts on the initial Node 24, Linux x64 target.

All database connectors, including SQLite, are deferred to a separate session. Generated GPU execution, custom failure mappings, domain HTTP status mappings, capability bridges, and an Effect-style dependency system are also deferred. SpacetimeDB research is archived separately in [spacetime-bend.md](spacetime-bend.md).

## Approved application ownership

The application target is stateless Bend business logic. Persistent business records live in DB tables or Redis and are read or written during invocation. Node owns external authentication sessions and connection context. Those sessions must not select a native worker or require retained Bend business state.

Long-lived workers may retain infrastructure such as validated configuration and live connections. A connection string is reusable Data and does not itself require affine resource ownership. Live handles require an owning lifecycle and exclusive use according to their connector contract. Infrastructure initialization must not reset durable business data during recovery.

Phase 3 requires explicit execution sessions and creates a native worker for each session. The approved Phase 4 design uses host-owned workers and stateless generated calls, with recovery for fresh invocations. Pools and a shared multi-endpoint live context are deferred. Native worker failure must not invalidate an unrelated external authentication session. Uncertain invocations must never be replayed.

The Phase 3 248-byte native payload limit is a BendFlow protocol policy, not a Bend-wide value limit. The approved Phase 4 maximum is 1,048,576 native payload bytes, including the connector reply tag. Its eight-byte frame header and four-byte outer prefix are additional overhead. Generated frames use version 2 and U32 container lengths; legacy Phase 2 framing remains separate.

Resolve the review findings and integrate verified code before claiming production packaging complete. Default text and List bounds remain 96 bytes and 32 items; explicit build options and per-service policies widen them within the payload and decoded-complexity limits.

## Typed outcomes, logging, and OpenAPI

### Result and Maybe boundary support

Recognize Base Result and Maybe explicitly. Preserve their constructors and field names in the existing external union representation:

| Bend constructor | External representation |
| --- | --- |
| `None{}` | `{ kind: "None", fields: {} }` |
| `Some{value}` | `{ kind: "Some", fields: { value: ... } }` |
| `Fail{error}` | `{ kind: "Fail", fields: { error: ... } }` |
| `Done{value}` | `{ kind: "Done", fields: { value: ... } }` |

Support quantities `&1` and `&2` when every payload is serializable under the existing boundary rules. An affine wrapper does not make its scalar or Data payload unrepresentable. This is a targeted exception for these Base types, not permission to expose arbitrary affine values.

Reject erased quantities, handles, functions, IO actions, affine Lists, dependent types, and recursive business datatypes. Preserve existing supported structural pairs and reusable Lists. During extraction, check the payload type of every Some, Fail, and Done branch recursively. At runtime, validate the value in the selected branch.

For stateful services, preserve `IO(State & Result<...>)` or `IO(State & Maybe<...>)`. State remains outside the outcome and outside endpoint arguments. Lifecycle acquisition and finalization remain necessary regardless of the return type.

Use declaration-order tags and field encodings, as for existing unions. Expected Fail and None values are valid replies. They do not invalidate the internal worker context or bypass output validation.

This supersedes the preliminary recommendation to keep Base Result and Maybe internal. Phase 3 remains a historical record of the completed implementation.

### Rich Bend-defined errors

Bend authors define error payloads as supported records or unions. Payloads may include machine-readable codes, diagnostic messages, relevant values, and bounded nested context. The generator derives schemas and client types from these declarations; authors do not duplicate their error shapes in Node.

Result's Fail branch explicitly identifies an expected failure for logging. Custom outcome unions remain supported values, but arbitrary constructor names do not establish failure semantics. Custom failure mappings are deferred until a caller needs them. Any future mapping must be the shared source for logging and error-case descriptions.

None represents absence, not necessarily failure. Do not log every None as an error or infer HTTP 404 from it. Do not treat a Result stored inside a successful payload as an endpoint failure without explicit mapping.

All error payloads obey the resolved text, list, expansion, and frame bounds. Generated requests and tagged replies must fit the configured native payload budget, at most 1,048,576 bytes. A successful reply's connector tag leaves at most 1,048,575 bytes for its encoded value, including any container lengths and union tags. Rich error branches count toward the same worst-case sizing as success branches. Do not truncate errors to make them fit.

### Structured Node logging

Generate failure observation at the Node invocation boundary after native decoding and output validation. Log the actual structured error value, rather than only an exception string or worker stderr.

Each event includes the service name, invocation correlation ID, worker identity or generation where available, failure category, and validated error value where available. Keep external gateway-session context separate from internal worker identity. Include external context only when supplied through the configured logging policy. Infrastructure events include a boundary stage and execution certainty when known. Keep worker diagnostics distinct from Bend-defined error data.

Provide a runtime logger hook with a default structured Node sink. Make redaction configurable before a value reaches the sink. Do not include raw request bodies, credentials, or raw wire bytes by default. Public domain error fields are already part of the reply contract; logging-only diagnostics must not be added to that reply implicitly.

Emit one failure event per invocation at the owning boundary. A logger failure must not change a settled service outcome or trigger a retry. Specify and verify this behavior before choosing the hook's final API.

### Generated OpenAPI and HTTP defaults

Generate an OpenAPI artifact from the same extracted boundary shapes and outcome metadata used by the runtime. Include service routes, required arguments, replies, and documented infrastructure responses. The approved stateless API has no generated execution-session controllers. External authentication sessions remain gateway-owned. Phase 3 has no OpenAPI generator; the first Phase 4 implementation emits and serves the document.

Represent each supported union with alternatives and discriminants. Expand nested Result, Maybe, and custom error unions so all declared cases are visible. Reuse schemas where appropriate without losing concrete generic payload types.

Default expected outcomes to HTTP 200. Fail, None, and custom failure values remain part of the response union. Do not infer HTTP status from a constructor name. Distinct domain statuses require explicit metadata and are deferred until a caller requirement justifies them.

Document the actual served transport. Existing RPC routes use the oRPC `{ "json": ... }` request and response envelope. If OpenAPI is served through a separate handler, document that handler's real paths and envelope separately; do not describe a plain JSON body for a route that expects the RPC envelope. Choose the supported oRPC/OpenAPI schema adapter during implementation and verify both the emitted artifact and live handler.

Publish supported ranges, resolved bounds, and strict object shapes. Some Unicode, UTF-8-byte-length, and canonical Nat constraints need descriptions or extensions because standard schema keywords do not fully express their runtime validation. Generate the artifact and provide a documented way to read it. A reference UI is deferred and does not block release.

"All possible outcomes" means all supported declared return variants plus documented framework and infrastructure responses. It does not mean that every possible process crash is a Bend-defined error case. OpenAPI and generated client types must not promise typed JavaScript throws.

## Distinct native boundary errors

Phase 3 uses `[255]` for invalid request decoding and failed reply encoding. Those stages have different execution certainty. Replace this ambiguity with versioned connector-owned outcomes, separate from the service's Result or custom union tags.

| Condition | Diagnostic category | Default HTTP behavior | Execution certainty |
| --- | --- | --- | --- |
| External input fails validation | `invalidInput` | 400 | Not invoked |
| Native rejects a request Node already validated and encoded | `invalidRequest` | 500; retire worker context | Not invoked |
| Invocation completes but output cannot be encoded | `outputEncodingError` | 500; retire worker context | Invoked; effects or state changes may have occurred |
| Old `[255]` handled by a retained legacy path | `legacyBoundaryError` | Preserve fatal 503 behavior | Unknown stage |
| Worker or connection disappears during an active call | Existing worker failure category | Preserve availability or deadline mapping | Completion may be unknown |

Treat native rejection after valid Node encoding as an infrastructure defect rather than blaming the external caller. Retirement of the affected internal worker context is the conservative default for a native contract violation. In the Phase 3 model this invalidates its execution session. It must not invalidate an external authentication session. Expected business failures remain nonfatal. Fresh-call recovery follows the approved host-owned-worker design and never authorizes replay of the failed invocation. Idle-death recovery remains an outstanding implementation defect.

Keep boundary diagnostics bounded and structured. Node can add service and correlation context without putting it in every native response. Distinguish categories and stages without exposing unrestricted stderr in public responses.

Version the wire policy and contract identity. Mismatched old and new generated packages must fail the handshake before invocation; legacy interpretation is not permission for silent cross-version compatibility. Keep unrelated legacy application codecs unchanged.

Never automatically retry an invocation because its response was lost or could not be encoded. IO execution does not imply rollback. Active abort and timeout do not establish cancellation or absence of effects.

## Standalone Node packaging

The consumer writes supported `api.*` declarations in Bend and runs one build command. BendFlow generates endpoint contracts, validation, codecs, client types, and native adapters without handwritten per-endpoint Node handlers or duplicate schemas. Build entry selection and application startup remain explicit.

Publish compiled ESM JavaScript and `.d.ts` declarations with stable package-owned build and runtime exports. Provide a CLI such as `bendflow build --entry FILE --out DIRECTORY`. Generated modules must use supported package exports rather than paths into this repository. Resolve tool dependencies deliberately; do not depend on a particular `node_modules` nesting layout.

Manage the pinned compatible Bend compiler in a versioned toolchain location outside the installed package directory. Validate compiler identity and required native build tools before generation. The final provisioning mechanism must account for the compiler inspection API and its resources; an arbitrary Bend executable is not a substitute for those APIs. Report setup failures with actionable diagnostics. Network provisioning needs explicit authority and must not be hidden in an install hook.

Distinguish prerequisite discovery, Bend validation, boundary extraction, native compilation, generated-TypeScript validation, and output replacement failures. Preserve useful compiler output and map staged-source diagnostics back to consumer files where possible. Build failure must preserve an invokable preceding output.

Emit executable JavaScript, declaration files, native workers, and a deployment manifest. Record target OS, architecture, known system-library requirements, compiler identity, wire policy, and artifact hashes. Native builds target their deployment platform; Linux artifacts are not portable to arbitrary operating systems or libc versions. Deployment must not need Git, Bun, Clang, TypeScript, or the compiler checkout after generation.

Verify the actual packed tarball in an unrelated consumer project. Exercise CLI and exported build APIs, exact client types, dependency resolution, relocation, executable permissions, failure recovery, and live endpoints with build tools absent. Inspect package contents for required runtime resources and third-party notices. Do not infer npm-install readiness from checkout tests. Publishing the package remains a separately authorized external action.

## Deployment CPU configuration

Retain two CPU evaluation threads per worker by default and explicit integer overrides from 1 through 64. Add `worker.threads: "auto"` as an opt-in. Detect process-available logical CPUs at deployment startup using `os.availableParallelism()` and applicable Linux cgroup quotas. Resolve the count once per host, clamp to the supported range, and pass explicit `+RTS --threads N --gpu off -RTS` arguments to BendRT. Report detection inputs, relevant limitations, and the resolved policy without exposing credentials.

Auto assigns detected capacity per worker. It is not a reservation or a shared host budget. Concurrent workers can oversubscribe the deployment. Worker pools and aggregate active-compute scheduling are deferred. Do not promise speedup merely because more evaluation threads are configured.

Verify numeric-override precedence, one-core and restricted-affinity environments, cgroup quota handling, invalid configuration before spawn, actual launch arguments, and native `IO.thread_count()`. Preserve queue, ownership, and cleanup behavior. Widening the 64-thread ceiling requires a separate decision.

## CPU-first release and GPU scope

The initial supported package target is Node 24 on Linux x64 with native CPU execution. Check native linkage and system-library compatibility. GPU-disabled launch arguments do not prove that a worker is free of CUDA dependencies; generated CPU artifacts must not accidentally depend on a local CUDA toolkit.

Generated GPU execution remains experimental and outside the completion gate. CPU evaluation threads do not determine GPU execution lanes. GPU support requires GPU-marked Bend work, compatible native and device artifacts, and verified execution on a capable device. Existing `build/cuda/profile.json` records a WSL2 concurrent-managed-access failure; `build/cuda/packaging.json` records failed packaging. Neither establishes successful GPU workload execution.

Future GPU qualification must use a compatible runner, verify actual device work and matching artifacts, and define host-thread, GPU-memory, and multi-worker admission policies. Do not silently fall back after an explicit unsupported GPU request.

## Deferred Bend native SQLite connectors

This research remains a starting point for the separate database session. SQLite implementation and verification are not Phase 4 requirements.

The [bend-over SQLite package](https://github.com/subtleGradient/bend-over/blob/907817337700fd1b85c8afbede625b6fe1ed001a/packages/sqlite/README.md) provides a native connector starting point. Its C effects run SQLite inside the Bend process on IO helper threads, bypassing Node for database operations. It offers bound queries, prepared statements, transactions, scoped cleanup, exact 64-bit integer/real values, and structured SQLite errors. This avoids intermediate JavaScript database values; results still require native-to-Bend conversion.

Required adaptations:

- Permit and package the connector's foreign effects in the generator; adapt registration and value layouts to BendFlow's pinned compiler ABI.
- Keep connection and statement handles in internal lifecycle state, with exclusive connection ownership throughout a transaction.
- Add result-size bounds, explicit busy-timeout and database configuration, and verify cleanup, rollback, and compiler compatibility with native integration tests.

These are project-level changes and do not require modifying Bend's compiler or runtime internals. The research inspected source; BendFlow integration has not been implemented or tested.

## Implementation plan

Each step ends with its behavioral checks before the next step proceeds. Implementation covers project extraction, generated adapters, Node runtime wiring, the connector protocol, packaging, and CPU configuration. Follow the resume order above to correct and integrate the first pass before fixing the final public package contract.

### 1. Extract supported outcomes

- Add explicit Base Result/Maybe recognition and recursively check every payload.
- Preserve closed aliases, imported types, generic instantiation, quantities, and state exclusion.
- Include recognized outcome identity in generated metadata; defer custom failure mappings.
- Verify both quantity forms, nested outcomes, empty cases, and targeted rejection of unsupported payloads.

### 2. Generate and transport outcomes

- Emit Bend codecs, Node codecs, Zod schemas, and exact client types for the recognized wrappers.
- Preserve the existing public union representation and declaration-order wire tags.
- Account for worst-case error branches in frame and HTTP body sizing.
- Verify independent golden bytes and live pure, IO, and stateful calls for Done, Fail, Some, and None.
- Verify malformed tags, truncated payloads, trailing bytes, oversized error values, and worker reuse after expected failures, including retained execution-session regression coverage.

### 3. Separate boundary stages

- Introduce distinct request-rejection and output-encoding categories with the selected fatal defaults.
- Update generated workers, Node decoding, HTTP mappings, and wire-policy fingerprints together.
- Verify request rejection before effects and output-encoding failure after an observed effect.
- Verify mismatch rejection, conservative legacy handling where retained, and no invocation replay after uncertain failure.

### 4. Observe structured failures

- Define the logger hook, default sink, correlation context, and redaction behavior.
- Use top-level Result failure metadata instead of constructor-name heuristics; defer custom mappings.
- Verify the complete Bend-error-to-Node-log path, structured values, and exactly one event per failure.
- Verify that None is not an automatic error, success payloads are not recursively misclassified, and logger failure does not change the response.

### 5. Generate OpenAPI

- Select compatible OpenAPI dependencies and the Zod schema adapter.
- Emit the document from the shared generated contract and supported outcome shapes.
- Provide the artifact and document how to read it; defer a reference UI.
- Verify each declared case, concrete nested payload, controller route, HTTP default, and infrastructure response in the artifact.
- Make real requests using the documented body shapes and confirm that the served routes match the document.

### 6. Package the consumer build and runtime

- Compile ESM exports and declaration files, expose the CLI, and package required resources.
- Remove repository-relative generated imports and tool-discovery assumptions.
- Implement pinned toolchain discovery or provisioning and staged build diagnostics.
- Emit relocatable native assets and target-aware deployment metadata.
- Verify an actual tarball in an unrelated consumer, build failure recovery, exact types, and runtime operation without build tools.

### 7. Resolve deployment CPU configuration

- Add opt-in auto-detection, preserve two by default and numeric overrides, and report resolved configuration.
- Verify affinity and quota cases, override precedence, launch arguments, and observed native thread counts.
- Qualify CPU-only artifact linkage on the initial target and preserve ownership and cleanup behavior.

### 8. Complete the generated-service gate

- Run existing compiler, type, unit, and integration gates plus the new outcome, logging, OpenAPI, package-consumer, and CPU-configuration cases.
- Exercise one generated service with nested Bend-defined errors through client invocation, Node logs, and the generated OpenAPI artifact.
- Check pure, IO, and retained-state behavior, queue ordering, cleanup, malformed payload rejection, and successful replies for regressions.
- Update Phase 4 status only after observed results satisfy the completion criteria.

## Completion criteria

- Supported Result/Maybe values work at every supported boundary position with exact generated client types.
- Bend-defined failures reach Node as validated structured values and produce useful correlated logs.
- OpenAPI displays every supported declared outcome without a second handwritten schema.
- Served paths and envelopes match the generated description.
- Native input rejection, output failure, and uncertain worker failure have distinct documented semantics.
- Expected failures preserve worker usability; infrastructure defaults do not replay uncertain calls or invalidate unrelated external sessions.
- Existing Phase 3 behavior passes its regression gates.
- The packed Node package generates and runs typed endpoints from an unrelated consumer project without repository-relative dependencies.
- Generated output remains invokable after relocation, and deployment does not require build tools.
- Build failures expose their owning stage and useful diagnostics while preserving preceding output.
- CPU auto-detection and explicit overrides reach BendRT with verified thread counts and CPU-only native linkage.
- The approved worker-ownership and payload decisions are reflected in generated contracts, diagnostics, deployment requirements, and behavioral checks.
- Database connectors and successful GPU device execution are not required for this CPU-first gate.
- No Bend compiler/runtime modification is required to complete Phase 4.
