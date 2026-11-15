# Phase 2 protocol reference

## HTTP routes

`startAppGateway` binds to `127.0.0.1`. Its returned `url` ends in `/rpc`. The contract in `contracts/apps.ts` defines these oRPC routes:

| Route | Input | Result |
| --- | --- | --- |
| `sessions/create` | A session `kind` and optional `execution` | A session ID, kind, and execution configuration |
| `<kind>/command` | A session ID and that kind's command | That kind's reply union |
| `sessions/close` | A session ID | `{ kind: 'ok' }` |

Session kinds are `numeric`, `collection`, `file`, `network`, `task`, `process`, `compute`, and `custom`. Each kind's command and reply schemas live in its corresponding file under `contracts/`.

Session IDs are UUIDs. Native resource IDs are positive `U32` values local to their session. A command routed to the wrong kind or an unknown session returns `NOT_FOUND`. Closing an already closed session returns `ok`.

Execution defaults to `{ profile: 'native-cpu' }`. The multithreaded configuration has `profile: 'multithreaded-cpu'` and an integer `threads` between 2 and 64. Hardware profiles are not accepted by create until their implementation and fixtures are configured.

`GET /capabilities` is outside `/rpc`. It lists supported kinds and available CPU profiles. Availability describes gateway support. Verification is recorded separately in the executed-test report. Unavailable hardware profiles include a reason.

## Binary values and limits

`createAppClient` and the gateway share an oRPC custom JSON serializer with type ID `1000`. The serializer encodes `Uint8Array` values as arrays of byte integers with oRPC metadata. It validates the array and reconstructs a `Uint8Array` on receipt. Plain JSON objects with numeric keys are not byte values.

| Value | Limit |
| --- | --- |
| HTTP request body | 4096 bytes |
| Native frame body | 256 bytes |
| Native application payload | 248 bytes |
| Default string | 96 UTF-8 bytes |
| Default binary field | 192 bytes |
| `U32` list | 32 items |
| `Nat` | $0$ through $2^{48}-1$, six bytes on the native wire |
| `U32` and `F32` bits | Four big-endian bytes |
| Timer inputs | At most 10000 milliseconds |
| Default session admission | 16 live, starting, or closing sessions |

Commands can impose smaller field limits. Task text, process input and arguments, network hosts, and datagram sends have command-specific bounds in their schemas and codecs. TCP and UDP receive sizes are between 1 and 192 bytes. File read sizes are between 0 and 192 bytes.

Strings must contain well-formed Unicode. The Node and native decoders reject overlong UTF-8, surrogate encodings, and code points above `U+10FFFF`. Command schemas reject extra fields. Native codecs reject unknown tags, truncated fields, and trailing bytes.

Current native string replies have a 96-byte limit. Oversized process or environment output returns `{ kind: 'fail', code: 75, message: 'reply exceeds text bound' }`. Oversized native error messages retain their code with a bounded replacement message. These errors do not claim rollback of an effect that already happened.

Bounded primitive codecs are implemented. General nested codecs and paging for larger results remain pending in the Phase 2 inventory.

## Ownership and shutdown

The gateway owns one process per session and admits one command at a time per worker. Competing commands return `TOO_MANY_REQUESTS`. A hard native deadline returns `GATEWAY_TIMEOUT` and makes the worker terminal. Worker loss and protocol failures return `SERVICE_UNAVAILABLE`. Commands are not automatically replayed.

For an idle application, close sends native operation `3` with an empty payload. `bend/loop.bend` consumes the native state through the application's shutdown handler, sends `[0]` as the acknowledgement, and closes the transport. A nonempty shutdown payload receives `[255]` without closing the application.

Node bounds graceful shutdown using `terminationGraceMs`, which defaults to 100 milliseconds. A busy, stalled, failed, or unresponsive worker uses forced termination. Node rejects further commands as soon as application close starts. Concurrent close calls share the same cleanup promise.

Gateway shutdown waits for in-progress startups and closes their workers even if the session never reaches the client. Cleanup failures propagate as errors. The existing Phase 1 worker termination path remains available for workers without the Phase 2 shutdown operation.

`IO.within` does not cancel a losing computation. Closing a session does not promise completion of outstanding background effects before the forced-termination deadline.
