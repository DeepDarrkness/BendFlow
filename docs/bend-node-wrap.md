# A Node.js wrapper for native Bend services

## Proposal

The proposal is to expose selected Bend functions through a small Node.js HTTP server. Node accepts JSON requests, validates them, and converts their contents to a shared wire format. A long-lived native Bend worker receives those bytes over localhost TCP, reconstructs the corresponding Bend values, calls the selected function, and returns an encoded result. Node converts that result to JSON for the caller.

For a function `f : Input -> Output`, the service preserves the familiar input-to-output model. A request containing `D1` becomes the Bend value `d1`, and `f(d1)` produces `o1`. A later request containing `D2` follows the same pipeline and produces `o2`.

Node owns HTTP, request admission, queuing, and worker supervision. Bend owns the computation and its datatypes. Each Bend worker processes one request at a time, but a computation can use Bend's parallel CPU runtime or GPU execution when the program supports it.

This arrangement gives other services access to native Bend execution without requiring them to embed BendRT or understand its heap representation. The initial design targets pure, stateless functions with concrete, serializable inputs and outputs.

This document describes a proposed wrapper, not an implemented or benchmarked system. Runtime findings were checked against Bend 2.0.40 at `f311527776559ce40095108ad6a7514a6c34aaa1` and revision `38103b3d46425026eff2d16bef93684967bee992`. The endpoint generator and shared codecs described below are application tooling to build.

## Architecture

```text
External services
       |
       | HTTP and JSON
       v
Node.js process
  routes and input validation
  bounded request queue
  asynchronous worker client and supervisor
       |
       | persistent localhost TCP, framed bytes
       v
Native Bend process, including BendRT
  read frame -> decode -> dispatch -> compute -> encode -> reply
                                      |
                                      v
                            parallel CPU or GPU work
```

The reply follows the same path back through Node to the external service. Both processes can run inside one container.

Bend compiles the worker as a native executable with its own `main`. Node starts that executable once and maintains a TCP connection. The connection carries application messages, not Bend runtime terms or pointers.

There are two actual event loops, one in Node and one for Bend IO. At the wrapper boundary, however, the Bend worker behaves as a synchronous computation pipeline. Node sends one request, waits asynchronously for its result, and then sends the next request.

## Endpoint generation

### An explicit set of exported functions

A service declaration selects the Bend functions to expose. It also supplies HTTP metadata that a Bend function signature does not contain.

For example, a declaration can associate `POST /check` with `check : CheckInput -> CheckResult`. It can specify a maximum request size, a deadline, and whether retrying the operation is safe. The declaration format is part of the proposed tooling.

The generator does not expose every definition in a Bend file. Helpers, proof functions, and definitions with unsupported signatures remain outside the service contract.

For a service with one function, dispatch is a direct call to that function. For several functions, the generated Bend dispatcher maps an operation identifier to a statically compiled call.

Bend provides TCP operations, but no built-in RPC system that discovers arbitrary functions and decodes their arguments. The generated dispatcher supplies that connection between received data and function calls.

### Bend types as the source of truth

The generator reads the selected functions and their input and output definitions from Bend. HTTP metadata accompanies those definitions rather than introducing a separately maintained copy of the domain types.

The initial supported types can include:

- `U32`, bounded `Nat`, `F32`, `Bool`, and `Unit`.
- Strings and byte sequences with defined encodings.
- Records and tagged unions with serializable fields.
- Lists, optional values, and result types built from supported types.

The generator rejects unsupported signatures during the build. Polymorphic exports need concrete instantiations. Dependent types need explicit handling of their runtime constraints. Closures and live resource handles do not become ordinary JSON values.

Arrays can cross as serialized contents that Bend reconstructs. That operation copies values and does not preserve shared identity or ownership between processes. Starting with first-order `Data` inputs and outputs keeps the initial contract smaller.

### Matching artifacts on both sides

From one contract, the generator produces:

1. Node request and response validators, with optional TypeScript declarations.
2. Node encoders and decoders for the wire format.
3. HTTP route registrations and method metadata.
4. Bend encoders and decoders for the same format.
5. A Bend dispatcher that invokes the selected functions.
6. A contract version or fingerprint for startup compatibility checks.

Generating both codecs matters more than generating routes alone. A generated Node route still risks drift if someone separately maintains its Bend decoder.

The generator needs parsed or checked Bend definitions. Extracting types with regular expressions would not reliably handle imports, nested types, or parameterized definitions. Using compiler internals would also require pinning their version because they are not a promised schema API.

### JSON outside, typed bytes inside

Node parses incoming JSON and validates it against the generated request schema. It then encodes a typed payload for Bend. Bend constructs native values only after decoding that payload.

The JavaScript object convention `{$: "Constructor", ...}` used by Bend's JavaScript exports is not a native wire format. Native constructor IDs and heap words are also unsuitable because they belong to a particular build and process.

A minimal request envelope can contain:

```text
u32be frame length | protocol version | request ID | operation ID | payload
```

The response contains a matching request ID, a result status, and an encoded output or error. The protocol defines the size and encoding of every field. Operation IDs belong to this contract, not to the generated C runtime's function IDs.

TCP does not preserve message boundaries. Both sides accumulate bytes until a complete frame arrives and handle multiple frames in one receive. Frame lengths and buffered data have explicit limits. Bend uses `TCP.recv_bytes` and `TCP.send_bytes` so framing happens before text decoding.

The codec also defines constructor tags, field order, optional values, string encoding, and numeric behavior. Native `Nat` values are bounded by $2^{48}-1$. JSON cannot directly represent NaN or infinity, so an F32 contract either rejects those values or gives them an explicit representation.

Bend Base does not provide JSON parsing. Keeping JSON in Node avoids adding a general JSON parser to the Bend worker. For a checker that already accepts a DSL, the payload can instead contain the DSL bytes that its existing Bend parser understands.

### Errors and contract checks

Node rejects invalid public requests before queuing them. Bend decoding returns an explicit failure for malformed payloads. Domain failures use the function's result type. Node separately reports worker disconnects, execution deadlines, and incompatible contracts.

Cross-language golden vectors check that Node and Bend agree on byte encodings. Integration checks exercise an actual request through the native worker. Bend can also prove codec round-trip laws and domain laws, but those proofs do not establish correctness of the Node implementation, TCP transport, or native backend.

## Node queues requests while Bend computes

### The asynchronous caller and synchronous worker

Node's event loop receives external requests while the Bend worker is busy. An asynchronous socket operation or Promise waits for the reply without blocking Node's event loop.

The queue is an application data structure. Node's event loop does not automatically provide a bounded, ordered worker queue.

Each worker has one active request. The queue sends another request only after the previous response arrives or the worker fails. From Node's perspective, the worker implements an asynchronous call whose internal computation is a synchronous input-to-output pipeline.

Node starts Bend with asynchronous process APIs and communicates through its socket. Synchronous child-process APIs would block Node and defeat this design. JSON parsing, validation, and encoding still consume Node CPU time, so request sizes need limits.

### Parallel work does not imply preemptible request handlers

Bend's IO event loop interleaves computations when they reach effects or wait for sockets, timers, or channels. It does not preempt a pure computation to run another request handler.

During `f(d1)`, the native runtime can distribute independent work across CPU threads or execute supported GPU work. That parallelism belongs to the current computation. Spawning more IO handlers or opening more connections does not automatically run `f(d2)` independently at the same time.

The wrapper therefore treats Bend's IO loop as the machinery for receiving and replying. It does not rely on that loop to schedule competing CPU-bound requests.

The parallelism must exist in the Bend program. The wrapper preserves native execution, but it does not convert a sequential algorithm into a parallel one.

### Queue bounds and deadlines

The Node queue has limits on pending requests and queued bytes. When those limits are reached, Node rejects additional work rather than allowing memory use to grow without bound.

A request can expire while it is queued, in which case Node removes it before sending it. A deadline reached after dispatch has different semantics. Node can stop waiting, but the Bend computation continues.

Bend's `IO.within` does not provide preemptive cancellation. Its losing computation continues, and its timer cannot interrupt pure evaluation. A hard execution deadline therefore requires terminating and replacing the worker. That action discards any worker-local state.

Pure, stateless functions make worker replacement and retries easier to reason about. For effectful functions, a lost response does not reveal whether the effect completed. Request IDs correlate replies, but safe retries also need idempotency or a defined deduplication mechanism.

If independent request execution becomes necessary, Node can supervise several Bend workers. Each worker still follows the same pipeline. Their CPU thread counts and GPU use need coordination to avoid contention.

## Setup and operation

The starting design needs a Node server, a compiled Bend executable, and one TCP client. Node's built-in `node:net` and `node:child_process` APIs cover transport and process supervision. Bend Base supplies the listener and byte-oriented socket operations. No Node native addon or embedded Bend runtime is required.

The application-specific work is the service contract, codec, and Bend adapter. A reusable generator reduces that work for later services, but writing the generator is a separate investment. A fixed service with a few functions can begin with explicit adapters and a small codec.

The worker build has the following shape:

```bash
bend worker.bend -o bend-worker
```

`worker.bend` contains or imports the generated dispatcher, codecs, and TCP loop. The official echo-server demo provides an accept-loop example. Its loop uses decreasing fuel so the definitions pass Bend's termination checks.

At startup, Node starts the executable, waits for readiness, establishes the connection, and checks the contract version. Bend binds to `127.0.0.1`. Node supervises process exit and drains diagnostic output so full output pipes do not stall the child.

Keeping the worker alive avoids process startup for every request. Node can restart a failed worker and return a service error for the affected call.

Node can enable `socket.setNoDelay(true)` on its sending socket. That setting does not configure Bend's socket. The checked Bend Base implementation exposes no `TCP_NODELAY` setter. Actual latency needs measurement with the chosen codec and workload.

## Resource limits for the whole wrapper

### One container, one shared budget

When Node starts Bend inside the same Docker container, the child inherits the container's cgroup membership. CPU and memory limits apply collectively to Node, Bend, and their threads.

A deployment can use:

```bash
docker run --cpus=4 --memory=2g --memory-swap=2g my-node-bend-image
```

Node starts the worker with:

```bash
/app/bend-worker +RTS --threads 4 --gpu off -RTS
```

The container has four CPUs' worth of aggregate execution time and a shared 2 GiB memory ceiling. It does not give each process that allowance. Equal memory and memory-swap values disable container swap.

The Bend thread count configures its worker pool, not a CPU reservation. Node still competes for CPU time within the same budget. The appropriate count depends on the workload and the CPU time Node needs for request handling.

Docker's `--cpus` sets CPU bandwidth. An optional `--cpuset-cpus` restricts execution to selected logical CPU IDs. Neither setting reserves those CPUs exclusively.

These OS-enforced limits make resource control independent of the application queue. The queue limits admitted work, while the container enforces the aggregate resource ceiling. A memory ceiling can cause an allocation failure or an OOM kill, so the wrapper cannot assume every limit violation becomes a recoverable result.

### Bend's CPU discovery

At startup, the checked native runtime starts with the online processor count. On Linux, it checks process affinity and reads common cgroup CPU quota paths to reduce its default thread count. A fractional quota rounds upward for the pool size, while the OS still enforces the fractional CPU budget.

The implementation checks fixed cgroup paths. It does not resolve every mount layout, inspect every ancestor quota, or continually resize the pool after startup. An explicit `+RTS --threads N -RTS` setting keeps deployment behavior predictable. The checked runtime caps the pool at 128 workers.

A Node V8 heap limit does not constrain Bend's heap. A Bend worker in a separate container also needs separate resource configuration. The shared-budget argument applies when both processes belong to the same limited cgroup.

### GPU resources

GPU execution needs a GPU-capable build and device access. CPU quotas and container RAM limits do not establish GPU execution or device-memory quotas.

Bend runtime options configure its GPU use and heap allocation. Deployment controls configure device access. Several workers sharing one GPU need an explicit policy. The CPU-only command above is a predictable starting point, not a restriction of the architecture.

## Benefits and scope

The wrapper exposes selected native Bend computations through an HTTP interface that other services can use. Callers do not need Bend tooling or a native Bend library ABI. They send JSON and receive JSON.

Compared with importing Bend's emitted `.mjs` functions into Node, the native worker retains BendRT's CPU parallelism and supported GPU execution. It also isolates Bend runtime failures from the Node process, although container-wide resource failures can affect both.

The design keeps scheduling responsibilities clear. Node admits and queues external work. Each Bend worker completes one computation at a time using the parallel resources configured for it. A container enforces their shared CPU and memory budget.

The first implementation can stay small by exposing a few pure functions, using one persistent connection, and limiting concurrency to one active call per worker. General endpoint generation expands the supported contract over time without changing that execution model.

## Sources

- [Existing interop research](bend-c-interop-research.md). Earlier findings and the checker use case. This document refines its claims about scheduling, retries, and serialization.
- [Bend reference index](https://bend2.dev/llms.txt). Unofficial index supplied for the discussion.
- [Bend guide](https://github.com/bendlang/bend/blob/38103b3d46425026eff2d16bef93684967bee992/guide/GUIDE.md). Native execution, IO scheduling, parallel calls, and runtime options.
- [Native runtime CPU discovery](https://github.com/bendlang/bend/blob/38103b3d46425026eff2d16bef93684967bee992/bend2/comp.ts#L4796-L4813). Affinity and cgroup quota handling.
- [Native runtime source](https://github.com/bendlang/bend/blob/38103b3d46425026eff2d16bef93684967bee992/bend2/comp.ts). Pool size, synchronous evaluation, and runtime argument handling.
- [Native target limitations](https://github.com/bendlang/bend/blob/f311527776559ce40095108ad6a7514a6c34aaa1/WONTFIX.txt). Native library exports and cancellation limitations.
- [TCP echo-server demo](https://github.com/bendlang/bend/blob/f311527776559ce40095108ad6a7514a6c34aaa1/demos/io_tcp_echos/main.bend). Listener, handlers, and fueled loops.
- [TCP byte sending implementation](https://github.com/bendlang/bend/blob/f311527776559ce40095108ad6a7514a6c34aaa1/bend2/effs/tcp_send.c). Partial writes and socket backpressure.
- [Absent Base JSON module test](https://github.com/bendlang/bend/blob/f311527776559ce40095108ad6a7514a6c34aaa1/tests/base/json.bend). JSON parsing is not built into Base.
- [JavaScript compilation](https://bend2.dev/learn/compile-to-javascript/). Sequential JavaScript execution and `.mjs` exports.
- [Codec proof example](https://bend2.dev/learn/command-codec/). Round-trip laws and their limits.
- [Linux cgroup v2 documentation](https://docs.kernel.org/admin-guide/cgroup-v2.html). Child membership, hierarchical limits, and memory accounting.
- [Docker resource constraints](https://docs.docker.com/engine/containers/resource_constraints/). CPU bandwidth, CPU affinity, memory, and swap.
