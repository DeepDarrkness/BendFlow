# Phase 1 protocol and lifecycle

## Native transport

`bend/transport.bend` contains the shared frame codec and exact-read loop. `bend/echo-worker.bend` is a test-only echo adapter.

Node launches one native worker and connects over IPv4 TCP to `127.0.0.1`. Bend accepts one connection and closes the listener. Readiness requires a valid handshake response.

The compiler source is Bend 2.0.40 at `f0cf0a7c573145501981c44d9c33e326185f008e`. The build rejects a dirty compiler checkout. Runtime arguments are `+RTS --threads 1 --gpu off -RTS PORT`. The worker ignores inherited `BENDRTS` defaults.

## Envelope

Every frame has a four-byte big-endian body length followed by an eight-byte header and a payload:

```text
body length: u32be
version:     u8
kind:        u8
request ID:  u32be
operation:   u16be
payload:     remaining bytes
```

Body length excludes its own prefix. Valid body lengths are 8 through 256 bytes, so a payload contains at most 248 bytes. Version is 1.

| Kind | Value | Request ID | Operation | Payload |
| --- | --- | --- | --- | --- |
| Hello | 1 | 0 | 0 | ASCII `BendFlow/echo/v1` |
| Hello acknowledgement | 2 | 0 | 0 | ASCII `BendFlow/echo/v1` |
| Echo request | 3 | Nonzero U32 | 65535 | Arbitrary bytes |
| Echo response | 4 | Same as request | 65535 | Same bytes as request |

Operation 65535 belongs to the transport test fixture. A future domain worker uses its own contract identifier and operation mapping.

The handshake payload is exactly 16 bytes. Both sides validate its identifier, message kind, request ID, and operation. Echo requests require a completed handshake. A second handshake on the same connection is invalid.

## Golden vectors

The following hexadecimal frames are hand-specified in `tests/framing.test.ts`:

```text
Hello:
00000018010100000000000042656e64466c6f772f6563686f2f7631

Hello acknowledgement:
00000018010200000000000042656e64466c6f772f6563686f2f7631

Echo request, ID 0x01020304, payload [0, 128, 255]:
0000000b010301020304ffff0080ff

Empty echo response, ID 0xffffffff:
000000080104ffffffffffff
```

Bend receives only the remaining bytes of a prefix or body. Subsequent frames stay in the socket. Node's decoder retains at most one 260-byte frame buffer and processes coalesced frames in sequence.

EOF at a frame boundary is normal closure. EOF inside a prefix or body is truncated input. Invalid lengths, versions, kinds, envelopes, and handshake identifiers close the connection. Bend inspects receive and send results and closes the returned socket on failure.

## Node worker interface

`BendWorker.start(options)` launches and handshakes with the worker. Options are:

| Option | Default |
| --- | --- |
| `executable` | Required native executable path |
| `port` | Ephemeral localhost port |
| `startupMs` | 10000 |
| `callMs` | 2000 |
| `terminationGraceMs` | 100 |

`echo(payload)` returns a `Buffer` with the native response. One call can be active. Another call fails immediately with `WorkerError.code === 'BUSY'`.

The startup deadline includes connection retries and the handshake. Diagnostic pipes drain continuously, with only recent output retained. The call deadline terminates the worker. A disconnect, child exit, invalid response, or mismatched identifier rejects the pending call and makes the worker unavailable.

`close()` is idempotent. It rejects an active call, destroys the socket, sends `SIGTERM`, and escalates to `SIGKILL` after the grace period. Waiting for process exit is bounded. Failure handling starts cleanup automatically. Awaiting `close()` confirms cleanup completion.

## Verification

`npm test` rebuilds the native fixtures and runs the required integration suite. Each test has a 15-second outer deadline. Socket and cleanup waits have shorter deadlines.

Tests cover golden bytes, every split point of a representative frame, byte-at-a-time delivery, coalesced frames, empty and maximum payloads, repeated exchanges, malformed frames, and partial EOF. Lifecycle tests cover missing executables, early exit, occupied ports, startup deadlines, handshake failures, pending-call termination, busy admission, and suspended-worker cleanup.

The lifecycle suite checks worker PIDs after shutdown. Startup-failure tests also compare Linux child-process lists before and after the rejected startup. Real native workers exercise normal transport and crash behavior. Test-only Node executables and TCP peers exercise missing readiness and malformed worker responses.
