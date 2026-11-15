# BendFlow Phase 2: testing stateful and effectful native computation

## Phase 2 status

Phase 2 has compiled workers and tests for the required `native-cpu` profile. The `multithreaded-cpu` profile is verified with four threads. Eight session kinds run through the Node gateway. The `gpu` and `graphics-audio` profiles report `unavailable`.

The implementation includes:

- One native executable per session kind, one process per session, and native `initialize`, `command`, and `shutdown` operations.
- A shared worker loop in `bend/loop.bend` and a shared codec in `bend/bytes.bend`.
- Typed Node codecs in `src/protocol/apps.ts` and `NativeApp` in `src/app.ts`.
- Gateway capabilities that list session kinds and execution profiles.
- Tests under `tests/phase2/`.
- The coverage inventory in `tests/phase2/coverage.json`.

Independent fixtures observe the effects:

- File writes and offset edits match `fs.readFile`.
- TCP and UDP tests use separate peers.
- `Process.run` uses `/bin/echo` and `/bin/ls`.
- A custom C effect writes a marker file.
- `IO.within` still prints after the timeout.
- Compute returns four CPU `Image` pixels and reports `IO.thread_count`.

`f32Add` bitcasts `U32` payloads to `F32`, so NaN follows native bits rather than JSON numbers. The Bend checker rejects duplicated affine numeric state, a match on a computed value, a non-decreasing recursive call, and a live use of an erased binder.

`npx tsc --noEmit` succeeds. `npm test` reports 98 passed, 0 failed, and 0 skipped. Phase 1 session tests still pass. The verified toolchain was Node `v24.11.0`, Bun `1.3.3`, Bend `2.0.40` at `f0cf0a7c573145501981c44d9c33e326185f008e`, and Ubuntu Clang `18.1.3`.

To reproduce the checks, run:

```sh
npx tsc --noEmit
npm test
```

Correct pixels alone are not GPU evidence. Bend runs `!` calls on the CPU when GPU execution is unavailable. This machine has no GPU-execution instrumentation, so the `gpu` profile is `unavailable`. It also has no window or audio fixture, so `graphics-audio` is `unavailable`.

## Recommended strategy

Build Phase 2 as a Bend feature-conformance suite exercised through the Node gateway, using a small set of statically compiled, stateful applications.

The key extension is an effectful transition:

**`step : State × Command → IO(State × Reply)`**

Pure commands can call pure helpers inside that transition. Effectful commands can operate on files, sockets, channels, or other resources, then return the updated state.

This keeps the external interface familiar while exercising Bend's actual native capabilities:

```text
External client
    → typed Node endpoint
    → command decoding in native Bend
    → stateful computation and effects
    → updated native state + reply
    → external client

Independent test fixtures observe the effects.
```

This strategy comes from reviewing both Bend guides, relevant Base declarations, and upstream tests. At the time of review, GitHub's `main` resolves to `f0cf0a7c573145501981c44d9c33e326185f008e`, which matches BendFlow's pinned compiler revision.

## 1. Use several small session applications

Group features into application-shaped sessions rather than creating an endpoint for every internal Base helper.

Each session has its own affine state, a fixed command union, and typed replies. An external service creates a session, sends commands repeatedly, and closes it.

| Session application | Commands to expose | Bend features exercised |
| --- | --- | --- |
| Numeric workbench | Calculate, convert, compare, accumulate | `Nat`, `U32`, `F32`, booleans, bit operations, arithmetic, parsing and formatting |
| Collection workspace | Store records, transform lists, sort, edit arrays, update maps and sets | ADTs, nested records, tuples, `Maybe`, `Result`, recursion, folds, templates, higher-order functions, affine arrays |
| File workspace | Open, read, write, append, inspect size, read and write at offsets, close | Persistent `File` ownership, text and binary IO, error handling |
| Network session | Connect, send, receive, poll, close; bind and exchange datagrams | TCP, UDP, listeners, sockets, EOF, fragmentation, backpressure, timed operations |
| Task session | Start bounded work, exchange channel messages, collect results | `IO.fork`, `IO.join`, `IO.spawn`, channels, timers, concurrency and ownership transfer |
| Process and environment session | Read fixture environment, inspect arguments, run a fixed fixture program | Environment, arguments, random numbers, stdout and stderr, `Process.run`, exit and failure behavior |
| Compute and rendering session | Parallel sum and sort, advance a simulation, render a frame, synthesize samples | CPU parallelism, GPU calls, arrays, `Image`, application state and event processing |
| Custom-effect session | Invoke a compiled custom effect and retain its results | C effect registration, returned constructors, immediate effects, helper-thread work and parked IO |

A capabilities endpoint identifies the compiled session kinds and available execution profiles. The commands remain ordinary, fixed application commands.

No Bend closures, runtime types, native pointers, or descriptors cross the RPC boundary. Closures, templates, and polymorphism are exercised inside compiled handlers. Callers select named operations and supply data.

## 2. Make affine resource persistence a central test

The running-total experiment establishes state persistence, but its state contains only numbers. The next important test is state containing a real affine resource.

For example:

1. An external client opens a file through the gateway.
2. Bend retains the `File` handle in session state.
3. Another request writes through that handle.
4. Another request reads or inspects it.
5. The client closes it.
6. A subsequent command using its resource ID receives an application error.

The external client receives an opaque resource ID, not an OS descriptor.

Base's `Map.pop` supports affine values, whereas `Map.get` requires copyable `Data` values. A resource table can therefore:

- Remove the resource from the table.
- Consume it in an operation.
- Receive the returned handle alongside the operation result.
- Reinsert it into the returned session state.
- Omit reinsertion when explicitly closing it.

Test error paths too. Bend's upstream `fail_keeps_handle.bend` demonstrates that a failed read can still return a usable file handle.

Dropping an affine handle does not replace explicit resource cleanup. Session shutdown needs to close retained files, sockets, listeners, windows, and audio handles.

## 3. Test observable behavior from outside Bend

Each feature needs evidence stronger than an endpoint returning success.

| Feature | Independent evidence |
| --- | --- |
| File writing | The test controller reads the actual file and checks its bytes |
| TCP sending | A separate peer records the bytes received |
| TCP receiving | A controlled peer sends fragmented data and closes at specified points |
| UDP | A separate datagram peer checks payload and sender information |
| Process execution | A fixture program reports its arguments, stdin, output and exit status |
| Concurrency | Controlled channel handshakes establish ordering and completion |
| Rendering | The external client checks returned pixels or a small reference image |
| Custom effects | A fixture observes an actual external change or controlled native result |

For every command family, test:

- A successful request.
- Boundary and malformed inputs.
- A sequence of requests that demonstrates persistent state.
- Failure followed by another valid command, where recovery is supported.
- Session cleanup and isolation.

Some tests use two independent client processes talking to the same session. Others use separate sessions to prove their states and resources do not interfere.

## 4. Treat effect failures differently from pure failures

A rejected pure operation can preserve its old state. An effectful operation may already have changed the external world before failing. A write may be partial, or a peer may receive data before the reply is lost.

The tests distinguish:

- Application results, such as overflow, a missing key, or a closed resource ID.
- Effect failures, such as a refused connection, failed file operation, or process launch failure.
- Infrastructure failures, such as worker death, RPC disconnect, or a hard deadline.
- Uncertain completion, where an effect happened but its response was lost.

Do not assume that an error means rollback. Test that state-changing commands are not automatically replayed after an uncertain outcome.

### The `IO.within` constraint

Both guides say that `IO.within` does not cancel its losing computation.

Consequently, do not race a computation that consumes session state and then continue using the old state after timeout. The losing computation still owns its inputs and may still perform effects.

For owned resources, prefer the available `try_*` operations, which return their ownership and results. For background jobs, transfer ownership into the job and collect it back through its completion result.

Add a dedicated test that proves a late effect still occurs after an `IO.within` timeout.

## 5. Expand the wire-format tests alongside feature coverage

The current 248-byte payload limit is sufficient for the initial experiment but too small for realistic collections, files, and images.

Phase 2 defines bounded payload sizes and explicit encodings for:

- Nested records, unions, optional values and lists.
- UTF-8 strings, Unicode characters and arbitrary bytes.
- `Nat` values up to the native limit of **2⁴⁸ − 1**.
- `U32` boundaries and wrapping arithmetic.
- `F32`, including explicit representations for NaN, infinities and signed zero.
- Array contents and resource IDs.

For larger results, use bounded chunks or pages. Preserve the existing framing limits and rejection behavior as explicit protocol policies.

Float tests need special care. The upstream limits document records differences between native and JavaScript behavior, including NaN payloads and formatting. Use native execution as the reference for those cases rather than blindly comparing JSON numbers.

## 6. Separate runtime coverage from compiler coverage

An HTTP request cannot directly verify erased arguments, termination rules, or proof checking. These remain important parts of Bend's capabilities.

Run two complementary test groups.

### Through the gateway

Exercise compiled programs using:

- Dependent structures, such as sized collections.
- Concrete polymorphic instantiations.
- Named template specializations.
- Closures stored and consumed inside native state.
- `Maybe` and `Result` monadic operations.
- Parallel recursive computations.

### At build time

Require positive checks and expected failures for:

- Duplicating affine state, arrays, handles, or closures.
- Invalid erased-variable use.
- Invalid template arguments.
- Non-decreasing recursion.
- Incorrect dependent-type inputs.
- Missing or false laws.

Keep proofs for the pure computational core separate from foreign effects. Use `--verdict` where applicable. A proof of the pure transition does not establish correctness of its C effect, framing, or external environment.

## 7. Use explicit execution profiles

Divide execution into:

1. A required native CPU profile covering all portable computation, files, networking, processes, concurrency and custom C effects.
2. A multithreaded CPU profile running the same parallel algorithms with different thread configurations.
3. A GPU profile exercising actual Metal or CUDA execution on suitable machines.
4. A graphics and audio profile exercising native window and audio effects on configured display and audio fixtures.

Pure rendering and sample generation can be tested without devices. Actual `Window` and `Audio` effects require a separate configured environment.

Bend can run `!` calls on the CPU when GPU execution is unavailable. Correct output alone is therefore insufficient evidence that a GPU test ran on a GPU. That profile needs execution evidence from runtime or device instrumentation.

Base currently has no built-in DNS, TLS, crypto, or complete HTTP implementation. Node supplies the public HTTP gateway. Track additional networking libraries or custom effects as extensions.

## 8. Implementation order and acceptance criteria

Implement in this order:

1. Numeric and collection sessions, including serialization and persistent affine arrays.
2. File sessions, proving handle ownership across requests and failures.
3. TCP and UDP, tasks and channels, processes, and custom effects.
4. Parallel compute, rendering, and hardware-dependent profiles.

Maintain a machine-readable coverage inventory mapping each intended feature or API to its command, tests, execution profile, and evidence. Compiler-only features get compiler tests. Report unavailable profiles explicitly.

Phase 2 is complete when every declared supported feature has evidence, and every effect family has a real externally observed test.

The recommended next slice is the collection workspace plus persistent file handles. Together they substantially extend the numeric experiment and test the ownership model that later effectful applications depend on.

## Sources

- [Bend language guide](https://github.com/bendlang/bend/blob/f0cf0a7c573145501981c44d9c33e326185f008e/guide/GUIDE.md)
- [Effects guide](https://github.com/bendlang/bend/blob/f0cf0a7c573145501981c44d9c33e326185f008e/guide/EFFECTS.md)
- [Base declarations](https://github.com/bendlang/bend/blob/f0cf0a7c573145501981c44d9c33e326185f008e/bend2/base.bend)
- [Runtime limits and intentional exclusions](https://github.com/bendlang/bend/blob/f0cf0a7c573145501981c44d9c33e326185f008e/WONTFIX.txt)
- [Upstream effect tests](https://github.com/bendlang/bend/tree/f0cf0a7c573145501981c44d9c33e326185f008e/tests/io)
- [Failed operations retain their handles](https://github.com/bendlang/bend/blob/f0cf0a7c573145501981c44d9c33e326185f008e/tests/io/fail_keeps_handle.bend)
- [Non-cancelling `IO.within` behavior](https://github.com/bendlang/bend/blob/f0cf0a7c573145501981c44d9c33e326185f008e/tests/io/within.bend)
