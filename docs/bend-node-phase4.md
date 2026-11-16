# BendFlow Phase 4: preliminary proposals

## Status

**Not started.** This document records preliminary proposals and open decisions. Database selection, connector ownership, and an Effect-style interface are not decided or implemented.

The [completed Phase 3 generator](bend-node-phase3.md) provides the Data-only Node-to-Bend boundary. Phase 4 explores durable database access, Node-global resource lifecycles, and standalone packaging while preserving that boundary.

## Should we add Maybe, Result, or an Effect-style interface?

The preliminary recommendation is to keep Base Maybe and Result internal. Custom Data unions already represent typed domain success and failure values without exposing Bend-specific constructors.

Pure and IO exports already receive generated trivial lifecycles. An error-return type cannot eliminate initialization required to acquire retained resources. A transparent external call may perform effects; it does not promise mathematical purity, rollback, or safe automatic retry.

| Approach | Implementation complexity | Feature quality |
| --- | --- | --- |
| Custom Data success/error union | Low; existing codecs support it | Typed domain failures with ordinary Data representations |
| Generator-recognized success/error convention | Moderate; metadata and consistent client/HTTP error handling | Uniform error contracts and better caller ergonomics |
| `Effect<Success, Error, Requirements>`-style capabilities | High; capability routing, asynchronous correlation, scoping, and cleanup | Reusable effectful services with explicit dependencies |

A capability interface could let Bend request Node-owned DB operations. Requirements would be startup/runtime metadata rather than endpoint values. Node would acquire capabilities and manage their lifetime; the runtime would route requests and scope release.

Open questions:

- Do custom Data outcomes provide enough error handling, or do callers need a recognized convention?
- Should requirements describe Node-owned capabilities, native Bend resources, or both?
- Who owns transactions, cancellation, timeouts, and resource cleanup?
- Can common resource lifecycles be generated without obscuring failure semantics?
- How does a worker distinguish a failed operation from a committed operation whose reply was lost?

Start with custom Data outcomes. Decide whether a capability interface is justified after the DB prototypes establish the required ownership and failure behavior.

## DB prototype recommendation

Candidate databases include celld, SQLite, and PostgreSQL. The database and connector placement remain open decisions.

The first recommended prototype uses a Node DB client for connection acquisition, pooling, and transactions, with generated Bend calls for Data transformations. Compare it with a path where Bend owns the DB workflow.

| DB ownership | Implementation complexity | Main tradeoff |
| --- | --- | --- |
| Node orchestration and Node DB client | Lowest | Mature clients and pooling; some workflow orchestration lives in Node |
| Native Bend connector | High per connector | Bend owns the workflow; native dependencies and resource handling cost more |
| Bend requests a Node DB capability | Highest initial platform work | Bend owns workflow logic while Node supplies existing clients |

The current worker protocol does not let Bend directly call a Node DB client. A capability bridge requires a bidirectional request/reply protocol, error correlation, and a deadlock policy. DB callbacks must not depend on starting another invocation in the same busy session.

### Node startup and shutdown

Node startup should load connection strings and configuration, acquire any Node-managed DB pools, and establish readiness. Secrets and pool handles must stay outside endpoint arguments. Node-global resources have an application lifetime; Bend retains session-specific state.

The prototype must define failed acquisition, partial-startup cleanup, readiness, graceful shutdown, and transaction ownership before fixing these interfaces.

### Prototype workload and evidence

Use frequent read-modify-write operations rather than an isolated SELECT. Compare equivalent workflows and transaction guarantees across connector designs.

- Verify concurrent updates without lost writes.
- Observe rollback after business or DB failure.
- Exercise startup failure and partial resource acquisition.
- Lose a Bend worker after commit but before reply and verify the uncertain outcome.
- Shut down with active requests and transactions.
- Exercise Data values larger than one native frame.
- Measure the complete request path under equivalent workloads.

A lost reply never implies DB rollback or permission to retry a committed write. Transaction guarantees and any idempotency mechanism must be explicit.

## Standalone packaging proposal

Package generated runtime code and dependencies so output runs outside the build checkout. Define generator provenance, target platform, dependency fingerprints, and native artifact requirements. Verify relocation without the compiler, Bun, or original Bend sources.

Packaging decisions should follow the DB prototype so the selected connector dependencies and global resource lifecycle are included. These are preliminary Phase 4 proposals, not completion claims.
