# BendFlow implementation plan for phases 1 and 2

## Status and scope

This document records the agreed implementation plan for the first vertical slice described in [the wrapper proposal](bend-node-wrap.md).

The slice exposes one pure `checkedAdd` function through a real oRPC endpoint backed by one persistent native Bend worker. It covers typed client calls, automatic datatype conversion, native computation, process cleanup, and tests at every step.

Implementation has not started. This document is the reference for implementation approval. Phases 3, 4, and 5 remain deferred.

## 1. Findings from Bend's source

The source review covers the HTTP fetch, HTTP server, TCP echo, and rollback netcode demos, plus relevant Base declarations and native TCP implementations.

The reviewed toolchain is Bend 2.0.40 at revision [`f0cf0a7c573145501981c44d9c33e326185f008e`](https://github.com/bendlang/bend/commit/f0cf0a7c573145501981c44d9c33e326185f008e). These findings come from source inspection. Phase 1 verifies native execution.

| Finding | Implementation consequence |
| --- | --- |
| Application records and unions declare constructors with typed fields. Construction supplies fields positionally. | The Bend decoder reconstructs application values using constructors in the declared field order. |
| `Data` is copyable. `Type` can contain affine values. Copying also requires reusable variable bindings. | The exported function uses concrete `Data` inputs and outputs. Socket ownership stays in the IO adapter. |
| TCP operations consume a socket and return it alongside the operation result. | Each receive and send threads the returned socket into the next operation, including error paths. |
| `TCP.recv_bytes` returns a list of U32-valued bytes. EOF is distinct from failure. | Framing operates on bytes and handles truncated frames and connection closure explicitly. |
| `TCP.send_bytes` handles partial writes and backpressure internally. It rejects elements above 255. | Encoders produce valid byte lists. The worker inspects send results and closes failed connections. |
| `U32` arithmetic wraps modulo 2^32. | `checkedAdd` detects overflow before addition. |
| Strings are character lists, separate from byte lists. | The first domain codec uses numeric fields only. |
| Demo HTTP helpers implement HTTP manually over TCP. Base does not provide a complete HTTP library. | Node and oRPC own HTTP and public serialization. |
| Echo and HTTP demos use decreasing loop fuel. Rollback also demonstrates unsafe perpetual loops. | The slice uses fueled loops, with fuel first in recursive signatures. |
| `IO.pass` and `IO.try` can turn failures into process termination. | Ordinary malformed requests use explicit results rather than fatal helpers. |
| Native constructor IDs and layouts depend on the compiler build. | The protocol carries application bytes, never native IDs, pointers, or heap words. |

The HTTP fetch demo assembles bytes before text decoding because a character can span receives. The rollback demo demonstrates explicit constructor-tag parsing, but its text and datagram protocol is not directly suitable for a persistent TCP stream.

The WONTFIX constraints also apply:

- Base provides no DNS, TLS, crypto, or HTTP library. The worker uses IPv4 localhost TCP.
- `IO.within` bounds waiting but does not cancel the losing effect. Node enforces a hard deadline by terminating the worker.
- Server helpers remain outside Base. The wrapper supplies its own framing and dispatch loop.

### Primary sources

- [TCP echo demo](https://github.com/bendlang/bend/blob/f0cf0a7c573145501981c44d9c33e326185f008e/demos/io_tcp_echos/main.bend)
- [HTTP server demo](https://github.com/bendlang/bend/blob/f0cf0a7c573145501981c44d9c33e326185f008e/demos/io_http_server/main.bend)
- [HTTP fetch demo](https://github.com/bendlang/bend/blob/f0cf0a7c573145501981c44d9c33e326185f008e/demos/io_http_fetch/main.bend)
- [Rollback netcode demo](https://github.com/bendlang/bend/tree/f0cf0a7c573145501981c44d9c33e326185f008e/demos/io_rollback_netcode)
- [Rollback datatype declarations](https://github.com/bendlang/bend/blob/f0cf0a7c573145501981c44d9c33e326185f008e/demos/io_rollback_netcode/netcode.bend#L38-L90)
- [Base TCP byte contracts](https://github.com/bendlang/bend/blob/f0cf0a7c573145501981c44d9c33e326185f008e/bend2/base.bend#L420-L463)
- [Native TCP receive implementation](https://github.com/bendlang/bend/blob/f0cf0a7c573145501981c44d9c33e326185f008e/bend2/effs/tcp_recv.c)
- [Native TCP send implementation](https://github.com/bendlang/bend/blob/f0cf0a7c573145501981c44d9c33e326185f008e/bend2/effs/tcp_send.c)
- [WONTFIX](https://github.com/bendlang/bend/blob/f0cf0a7c573145501981c44d9c33e326185f008e/WONTFIX.txt)

## 2. Selected vertical slice

### Function contract

`checkedAdd` accepts a nested operands record:

```json
{
	"operands": {
		"left": 7,
		"right": 5
	}
}
```

The success result contains a nested value record:

```json
{
	"kind": "sum",
	"value": {
		"total": 12
	}
}
```

The overflow result is a separate variant:

```json
{
	"kind": "overflow"
}
```

Both operands accept integers from 0 through 4,294,967,295. Addition succeeds only when the mathematical sum fits within that range. Overflow is a normal domain result, not an RPC error.

### Conversion coverage

The function is deterministic, has no side effects, and has bounded computation. It exercises:

- Nested records.
- Unsigned integer validation and byte order.
- Native constructor field ordering.
- Tagged-union outputs with different shapes.
- A domain failure distinct from a transport failure.

Hang tests suspend the worker externally. They do not add a deliberately broken application function.

### Bend datatype mapping

| Public schema | Bend representation |
| --- | --- |
| Nested `operands` object | An `Operands` Data constructor with two U32 fields |
| Request object | A `CheckedAddInput` Data constructor containing `Operands` |
| `"sum"` variant | A `Sum` constructor containing an `AddValue` record |
| `"overflow"` variant | An `Overflow` constructor with no fields |

Transport request IDs stay in the envelope rather than becoming application fields.

## 3. oRPC integration

The public interface uses oRPC contract-first APIs:

- `@orpc/contract` supplies the shared contract.
- Zod supplies runtime input and output schemas.
- `@orpc/server` supplies the [Node HTTP adapter](https://orpc.dev/docs/adapters/node-http).
- `@orpc/client` supplies the standard HTTP RPC link.

The contract is a client-safe module with schema-derived TypeScript types and no dependency on worker internals.

```text
External TypeScript service
    | shared contract, standard oRPC client, and server URL
    v
Node oRPC handler
    | validates input
    v
Fixed request codec
    | binary frame
    v
Native Bend decoder
    | constructs CheckedAddInput
    v
checkedAdd
    | constructs Sum or Overflow
    v
Bend encoder -> Node decoder -> oRPC response
```

The caller invokes `checkedAdd` with an ordinary typed object and receives the typed result. The caller performs no Bend-specific conversion.

### Automatic conversion in this slice

The fixed Node and Bend adapters are written once and run automatically for every invocation.

A TypeScript interface disappears at runtime. An oRPC validation schema alone does not specify native constructor ordering or wire tags. The slice therefore has an explicit fixed mapping between the public schema and Bend datatypes.

Shared golden vectors and native tests verify the mapping. This establishes runtime conversion for the selected schema. General schema-driven or compiler-driven generation remains phase 4.

## 4. Phase 1: native transport and lifecycle

Phase 1 establishes reliable framed byte exchange with a native Bend process before adding the application codec.

### Step 1.1: reproducible toolchain

Planned work:

- Pin the reviewed Bend revision.
- Verify Bun for the Bend compiler and a suitable Clang for CPU-native compilation.
- Use Node 24 LTS for the wrapper.
- Compile and launch native binaries with an explicit CPU-only runtime configuration.

Required tests:

- Check and compile a minimal Bend program.
- Run the native executable and assert its result and exit status.
- Fail clearly if required tools are missing.
- Record the toolchain versions used by the suite.

### Step 1.2: framed byte transport

The fixed envelope has these fields:

| Field | Encoding |
| --- | --- |
| Body length | U32 big-endian, excluding its own four bytes |
| Protocol version | U8 |
| Message kind | U8 |
| Request ID | U32 big-endian |
| Operation ID | U16 big-endian |
| Payload | Message-specific bytes |

Startup includes a handshake with a fixed contract identifier checked by both sides. Exact message-kind values and handshake bytes are specified before implementation and covered by golden vectors.

Bend uses an exact-read loop. It reads the length, validates the length, and receives only the remaining body bytes. This handles fragmentation and leaves subsequent frames in the socket. Node uses a bounded frame decoder.

A test-only framed echo worker exercises transport independently of domain conversion. It uses the same Bend framing module as the final worker.

Required tests:

- Empty and nonempty payloads.
- Byte values including 0, 128, and 255.
- Every possible split point for a representative frame.
- Several frames sent in one write.
- Maximum allowed frame and oversized length.
- EOF midway through the prefix or body.
- Invalid version, message kind, and handshake identifier.
- Repeated exchanges through one persistent connection.

### Step 1.3: minimal process ownership

Node owns:

- Asynchronous process launch.
- Bounded connection attempts and handshake.
- Diagnostic pipe draining.
- One active call.
- Pending-call rejection on disconnect or child exit.
- Bounded shutdown and forced termination when necessary.

The connection and handshake establish readiness. Readiness does not depend on a stdout message.

Required tests:

- Missing executable and immediate child exit.
- Occupied worker port.
- Startup timeout.
- Child termination during a pending exchange.
- Suspended worker followed by forced cleanup.
- Shutdown leaves no child process or open connection.

### Phase 1 completion criteria

The native transport passes all required tests. Every test has a bounded wait, so a failed worker cannot leave the test runner waiting indefinitely.

## 5. Phase 2: complete typed call

Phase 2 establishes a call from a separate TypeScript client to the real Bend function over oRPC.

### Step 2.1: fixed contract and domain function

Planned work:

- Define strict input and output schemas.
- Reject missing fields, extra fields, fractions, negatives, and out-of-range numbers.
- Implement the pure Bend datatypes and checked addition.
- Keep the pure function separate from TCP effects.

Required tests:

- Ordinary addition and zero operands.
- Maximum U32 plus zero.
- Exact-boundary sum.
- Overflow by one and maximum plus maximum.
- Invalid public inputs.
- Native execution of the domain cases before HTTP integration.

### Step 2.2: matching codecs

The request payload contains two fields:

```text
left: u32be | right: u32be
```

The response payload has two variants:

```text
sum:      tag 0 | total: u32be
overflow: tag 1
```

The codecs reconstruct nested records and union variants automatically. They reject wrong payload lengths, unknown tags, and trailing bytes.

Required tests:

- Hand-specified golden bytes for numeric boundaries and both variants.
- Node encoding decoded by native Bend.
- Native Bend encoding decoded by Node.
- Explicit rejection of malformed payloads.
- Fixed-seed randomized operand pairs checked against a JavaScript mathematical oracle.
- Valid calls still succeed after a recoverable malformed-payload response.

The mathematical oracle exists only in tests. Production computation runs in Bend.

### Step 2.3: oRPC handler and external client

Planned work:

- Implement the contract using the worker call interface.
- Expose the contract under `/rpc` on localhost.
- Validate the decoded result against the output schema.
- Add a separate example client that imports only the public contract and standard oRPC client libraries.

Required tests:

- A real client call travels through HTTP and Node to native Bend and back to the client.
- Both success and overflow results.
- Invalid requests rejected before dispatch.
- Repeated calls reuse the same worker PID.
- Client compilation verifies inferred input and output types and rejects invalid shapes.
- Client imports cannot pull in worker or process modules.

### Step 2.4: end-to-end failure behavior

Required tests:

- A worker killed during a call produces a bounded infrastructure error.
- A real worker suspended with Linux `SIGSTOP` hits the call deadline and is forcibly terminated.
- A second call while the worker is occupied receives a busy error.
- Malformed worker responses and mismatched request IDs fail the call.
- Application overflow remains a normal typed result.
- Service shutdown cleans up an active or idle worker.

The suspended-worker test is deterministic and requires no extra exported function.

## 6. Local operating policy

| Setting | Initial policy |
| --- | --- |
| Worker count | One |
| Bind addresses | `127.0.0.1` |
| CPU configuration | One Bend CPU thread, GPU off |
| Active calls | One |
| Additional concurrent calls | Busy error |
| HTTP body limit | 1 KiB |
| Frame body limit | 256 bytes |
| Startup deadline | 10 seconds, configurable for tests |
| Call deadline | 2 seconds |
| Termination | SIGTERM, then SIGKILL after a short grace period |

Admission fails immediately while the worker is busy. The bounded queue and automatic restart policy belong to phase 3.

A fatal worker failure or timeout makes the service unavailable until the service is started again. The slice performs no replay.

## 7. Planned artifacts

The following paths describe planned files, not an existing implementation:

```text
contracts/             Shared oRPC contract and schemas
src/server.ts          Local Node HTTP entry point
src/worker.ts          Process, connection, and active-call ownership
src/protocol/          Framing and fixed Node codecs
bend/domain.bend       Datatypes and checkedAdd
bend/transport.bend    Byte framing and socket loop
bend/worker.bend       Handshake, dispatch, and response handling
tests/                 Unit, native, transport, and oRPC integration tests
examples/client.ts     External-service usage example
```

Build scripts compile native fixtures once per suite run. Tests use isolated processes and ports, bounded waits, and unconditional cleanup. Missing native prerequisites fail the required integration suite rather than silently skipping it.

## 8. Final acceptance criteria

Phases 1 and 2 are complete when all of these conditions hold:

1. A client using the shared TypeScript contract receives correct results from native Bend.
2. Nested records and union variants convert automatically.
3. Boundary values, malformed data, and repeated requests pass their tests.
4. The same worker handles repeated calls over one connection.
5. Hang and crash tests finish predictably and leave no child processes.
6. All required tests pass against the pinned Bend revision.

## 9. Deferred phases

- Phase 3 adds bounded queueing and automatic worker recovery.
- Phase 4 adds general contract and codec generation.
- Phase 5 adds deployment packaging and broader operational support.
