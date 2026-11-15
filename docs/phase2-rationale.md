# Phase 2 architecture

## Problem

Phase 2 must prove native stateful and effectful computation through the Node gateway. The current numeric session is a persistent process with one outstanding call, a 248-byte payload, and hard timeout termination. Effectful sessions need affine resource persistence, explicit native cleanup, and independent external evidence.

## Usage (caller's view)

```ts
const api = connectGateway(url);
const files = await api.open({ kind: 'file', profile: 'native-cpu' });
const opened = await files.command({ kind: 'open', path: 'fixture.bin', mode: 'write' });
if (opened.kind === 'opened') {
  await files.command({ kind: 'write', resource: opened.resource, bytes: [0, 255] });
}
await files.close();
```

```ts
const numeric = await api.open({ kind: 'numeric' });
await numeric.command({ kind: 'accumulate', amount: '281474976710655' });
await numeric.close();
```

```ts
const tasks = await api.open({ kind: 'task' });
const started = await tasks.command({ kind: 'startSleepPrint', ms: 150, text: 'late' });
if (started.kind === 'started') await tasks.command({ kind: 'join', job: started.job });
await tasks.close();
```

## Shape

Each session kind compiles to its own native executable. The gateway starts one process per session and keeps a typed exclusive lease for the whole public command, including chunked transfers. Bend owns application state and affine handles. Node owns HTTP, process lifecycle, and independent fixtures.

Public schemas hide framing and encoding. Native operations are `initialize`, `command`, and `shutdown`. Commands and replies stay inside 248 payload bytes; larger values use bounded chunks or pages.

Application and effect failures are typed replies. Infrastructure failures report `notDispatched` or `unknown` completion and never replay.

## Synthesis decision

Candidate A is the base: one compiled worker per kind, one process per session, isolated application files, and a shared bounded codec. Candidate B supplied the exclusive command lease, native `initialize`/`command`/`shutdown` operations, and transport-failure cleanup that must return application state.

A universal worker was rejected because it would mix affine state machines in one binary and force shared-file dispatch. Generic transfer RPC was rejected because it would expose native ownership choreography.

The family check for a separate-model judge did not run; synthesis used the two candidate sketches and the existing worker constraints.

## Tradeoffs accepted

- We accept one process per session in exchange for isolation and explicit cleanup.
- We keep the 248-byte frame limit and add chunks in exchange for preserving Phase 1 framing tests.
- We accept that hard timeout cannot promise native cleanup, so those cases report interruption.

## Alternatives considered

- Universal worker with kind-tagged state: simpler deployment, but one file would own every affine resource table.
- Shared transfer service in Node: smaller native code, but effects would leave Bend.

## Open questions and risks

- Does this machine provide GPU, window, and audio fixtures, or should those profiles report unavailability?
- Which runtime diagnostic is the most reliable GPU-execution evidence?

## Next implementation step

Freeze the shared codec, native loop, and session registry, then implement numeric, collection, and file applications.
