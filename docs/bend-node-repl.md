# Research: a Node-accessible Bend REPL

## Scope and findings

This document examines a persistent Bend REPL exposed through the BendFlow Node gateway. External callers submit both Bend source code and application data through Node. Node manages sessions, compiler requests, execution, and responses.

A correctly checked REPL is feasible with the current Bend checker. The nearest implementation uses an append-only compiler session and a persistent JavaScript evaluator. Each submission becomes a checked Bend function that consumes available inputs and returns a result with the bindings retained for later submissions.

Native execution remains useful for compiled session snapshots and statically compiled applications. Loading arbitrary new native code while retaining existing native closures, arrays, and handles requires additional compiler and runtime support.

These are research findings and an architectural recommendation. The proposed REPL API, compiler adapter, and evaluator are not implemented or approved by this document.

### Evidence and relation to the wrapper

The Bend review uses revision `f0cf0a7c573145501981c44d9c33e326185f008e`, which GitHub `main` resolved to during the research on 2026-11-15. It matches BendFlow's pinned Bend 2.0.40 toolchain. Bend-specific findings use this revision unless stated otherwise. The supplied [Bend reference index](https://bend2.dev/llms.txt) is an unofficial guide to the upstream resources.

The [wrapper proposal](bend-node-wrap.md) establishes Node as the public interface to a persistent native worker. The [phase 1 completion report](bend-node-phase1.md) records working framed transport and worker lifecycle management. The [phase 2 research](bend-node-phase2.md) extends that model to statically compiled, stateful and effectful sessions.

Those sessions demonstrate the application model needed for resource persistence. A language REPL adds source submission, checking against earlier definitions, and execution of newly compiled code.

The checker findings below include in-memory probes against the pinned source under Node 24. They verify specific checking behaviors, not a complete REPL or cross-generation runtime compatibility. Comparisons with other projects come from their official documentation and source. No REPL latency or throughput measurements were taken.

## 1. Why a Bend REPL is hard

### Persistence has several meanings

A process that remains alive does not necessarily retain a language environment or previously computed values. The relevant levels are:

| Level | What survives | Additional capability |
| --- | --- | --- |
| Interactive calls | The worker and connection | Repeated calls to already compiled functions |
| Stateful application | Explicit application state | Fixed commands update state between requests |
| Definition-persistent REPL | Imports, functions, types, laws, and expression definitions | Later submissions compile against accepted declarations |
| Live-value REPL | Previously computed values | Later submissions use those values without rerunning their initializers |
| Live native REPL | Native values and newly loaded native code | New compilation units execute in the existing runtime |

BendFlow's framed transport addresses process persistence. A fixed transition such as `State × Command → IO(State × Reply)` addresses application state. Neither makes arbitrary received source executable.

### Affine bindings cannot become unrestricted namespace entries

An ordinary REPL often retains an object under a name and permits later cells to read it repeatedly. Bend permits at most one live use of an ordinary binding. Reusable `+` bindings require a suitable `Data` type. Arrays, closures, and resource handles cannot be treated as freely copyable values. [B1]

A live-value session therefore needs to remember whether a binding is available, consumed, reusable, or returned by an operation. Checking cells independently against the same unchanged context can permit illegal reuse across cells.

Retaining an affine value also affects result display. A generic printer cannot consume a resource and then silently leave the original resource available. First-order `Data` can have a copyable display representation. Affine values need an opaque description or a checked inspection operation that returns their ownership.

### Dependent types connect bindings across submissions

In a dependent environment, the type of one binding can mention another binding. A sized collection can depend on an index. A proof can depend on values and definitions used in its proposition.

The session must preserve those relationships as checked terms. A runtime dictionary containing values and printed type names is insufficient.

Consuming a value does not necessarily erase its identity from all types. Bend checks type positions, erased arguments, and equality endpoints without runtime demand. A consumed binding may remain necessary as an erased name in another binding's type. The REPL must retain that identity without permitting another live use. [B1, B2]

An output type that mentions a function's input cannot escape with an unbound index. The session adapter must retain the index's checked identity or package the index and value together in a dependent structure. Reflecting arbitrary runtime objects back into compiler terms is not a general solution. Closures and opaque handles do not expose such a representation.

### Redefinition can change the meaning of earlier types and proofs

Dependent conversion can unfold definitions. Changing a definition under an existing name can change what an earlier type means or how an earlier proof checks.

Bend's parser rejects ordinary duplicate definitions. Direct mutation of compiler objects bypasses that restriction, but the checker does not invalidate all dependent elaborations and template instances afterward. A REPL needs immutable definition generations or a rebuild policy. [B3]

An unfilled law is another relevant boundary. Before its implementation, its reference is stuck. After implementation, the reference may unfold. An accepted, computationally stable prefix should therefore exclude outstanding ordinary laws and TODOs. A proof workbench can retain incomplete drafts separately from the executable session. [B4]

### Compiler state and runtime state have different lifetimes

The compiler remembers terms, definitions, types, and template instances. The evaluator remembers actual values. Recompiling a function does not require executing it, but rerunning an old initializer can recreate a different value or repeat an effect.

Previously computed values must enter later generated code explicitly. A newly compiled module does not automatically inherit Bend bindings from an earlier module.

### Native output does not provide dynamic loading

Bend currently emits one C program with its own `main`. It documents no separate compilation, no incremental builds, and no existing REPL. A native library target with exported definitions, a header, and a lifecycle is planned but not scheduled. [B5]

The native worker's dispatcher is fixed at compilation. Receiving source over TCP cannot extend that dispatcher. Compiling each cell into an independent shared library would still leave heap ownership, function identities, runtime initialization, and value compatibility unresolved.

### ClojureScript and PureScript solve easier typing problems

ClojureScript does not check affine ownership or dependent input and output relationships. PureScript has a richer type system than basic Hindley-Milner, but ordinary runtime values generally do not appear directly in types as they do in Bend.

Their REPLs provide useful compiler and evaluator structures. They do not supply the session-transition rules required by Bend. Rust's evcxr addresses moved values and is a stronger ownership precedent, but it does not solve Bend's dependent context either.

## 2. What is feasible now and what needs to be built

### Feasibility by execution model

| Model | Present feasibility | Work needed |
| --- | --- | --- |
| Fixed native commands with persistent state | Supported by compiled Bend transitions and the Node worker model | Application commands, codecs, ownership-preserving state, and cleanup |
| Retained definitions with fresh expression evaluation | Feasible with the checker and generated compilation units | Source-session adapter, expression wrappers, diagnostics, and result display |
| Persistent JS values across newly compiled cells | A credible implementation path, not yet demonstrated as a Bend REPL | Checked transitions, typed value store, generation compatibility, and cross-cell ownership |
| Native snapshots with state restoration | Feasible in principle for an explicitly supported serializable state schema | Rebuild, worker replacement, codecs, compatibility checks, and a reload boundary |
| New native code with uninterrupted live native values | Requires compiler and runtime changes | Loadable units, stable ABI, shared runtime, typed handles, and code lifetime management |

### The checker already measures the required usage

`bend.ts` defines a `Ctx` mapping variable identities to names, quantities, and dependent types. `term_infer` returns a type, an elaborated term, and a `Uses` map. `term_check` returns an elaborated term and a `Uses` map. [B2]

Sequential uses add through `uses_add`. Alternative branches combine their usage with a maximum. `uses_close` rejects measured usage above the binding's allowance. Lambda and let checking call this operation when their binders close. [B6]

This is enough to check a generated cell's ownership rules. It is not an automatic session update. The context remains unchanged after checking.

### Dependent transition checks work in the current checker

The in-memory probes produced these results:

| Probe | Observed result | REPL consequence |
| --- | --- | --- |
| Check the same `Lone` variable twice against the same context | Both checks succeed, each reports `Lone`, and the context remains unchanged | The adapter must track consumption across submissions |
| Combine those usage maps and close the original binding | Rejected as consumed more than once | Existing checker operations enforce the combined usage |
| Return one affine input twice from a generated function | Rejected as consumed more than once | Complete function checking enforces the cell's resource accounting |
| Use an erased index in another argument's dependent type | Accepted | A consumed index can remain available for typing |
| Use that erased index as a live result | Rejected | Retaining the typing identity need not restore runtime availability |
| Return a dependent value under an incompatible index | Rejected | The checker validates the output's dependent relationship |
| Append a definition and validate after the accepted prefix | Accepted, with the earlier elaboration retained | Append-only incremental elaboration is supported |
| Reject a candidate created with the CLI-style book fork | The accepted book remains unchanged | Candidate checking can have a separate commit boundary |

For example, the checker accepts this transition:

```bend
type Witness<-q: Quant> is Data:
	Witness{}

type State is Type:
	State{q: Quant, w: Witness<q>}

def step(q: Quant, w: Witness<q>) -> State:
	State{q, w}
```

Changing the result to `State{&2, w}` fails because the supplied `Witness<q>` does not establish `Witness<&2>`. This example tests a symbolic dependency, not a claim about an application-specific witness.

The checker also accepts an erased dependency in a later transition:

```bend
def later(-q: Quant, w: Witness<q>) -> Witness<q>:
	w
```

It rejects returning `q` as a live value from a function whose parameter is `-q`. [B2, B6]

### Incremental checking trusts an unchanged prefix

`book_valid(book, done)` takes the first `done` order events as already validated. The CLI uses this mechanism with a seeded Base book. New events receive signature and body checks. [B4, B7]

Safe reuse requires a successfully checked, complete prefix whose meanings remain unchanged. The candidate may append fresh declarations and freshly checked template instances. It must not replace existing types, bodies, constructors, or cache entries.

`done` is a trusted offset, not a checked-book certificate. It counts events, not unique names. A law declaration and its later implementation can have separate events.

The function still scans the book and its order. New dependent conversions may evaluate old definitions. Incremental elaboration therefore avoids rechecking accepted bodies, but does not promise work proportional only to the new source.

### Checking needs an isolated candidate

Parsing and checking mutate book tables, elaborations, template maps, and incomplete-code counters. A failed check does not roll those changes back. [B3, B4]

The CLI's `book_seed` creates fresh tables, copies declaration records, and copies template maps. That is a suitable starting point for fresh-only additions to a complete, stable prefix. It is not a general snapshot for arbitrary definition mutation or other compiler consumers. [B7]

The executable session must reject incomplete candidates. Parsing `?TODO` increments the book's hole counter, while unfilled ordinary laws add holes during validation. `term_check` itself accepts `Hol("TODO")` against any goal. The completeness check must therefore use trusted parsing and counter provenance, or explicitly inspect generated terms. [B8]

For proof claims, the REPL must distinguish ordinary checker acceptance from an applicable `--verdict` kernel result. Neither establishes correctness of Node codecs, external effects, or backend execution. Unsafe and foreign definitions also have different guarantees. [B1, B5]

### The JavaScript boundary provides execution, not a checked session

`-o module.mjs` emits callable non-IO definitions. Node can load the generated module and invoke those definitions. This is the nearest existing execution boundary for new cells. [B9]

Host conversion is shallow. Strings and characters have specific conversions, `Nat` input receives a check, and `F32` input receives rounding. Other values generally pass through. Constructor tags alone do not establish a type identity, and the wrapper does not enforce ownership across calls. Arrays cross without copying. [B9]

Compatible first-order values may pass between generated modules, but cross-generation compatibility needs tests and explicit schemas. Closures retain their old code and captures. A new module cannot silently reinterpret an old closure or opaque handle.

The JS target is sequential and does not provide BendRT's native CPU or GPU parallelism. The `.mjs` export boundary also does not provide a general IO-cell evaluator. An effectful REPL needs an additional scheduler and effect adapter. [B5, B9]

### Missing components

A useful implementation needs:

- A Node session API accepting source, typed data, and references to retained bindings.
- A parser and compiler adapter for source fragments, imports, explicit annotations, and source locations.
- A checked session context with stable identities and definition generations.
- A generator for complete transition functions and dependency-preserving outputs.
- A runtime store that transfers affine inputs and records returned bindings.
- Type-directed codecs for external data, with explicit support for dependent constraints.
- A result-display policy that preserves ownership.
- Serialized execution, revision checks, bounded compilation and execution, reset, and cleanup.
- Generation retirement and rules for values that keep older code alive.
- Separate support for IO cells and native reloads.

Dependent conversion uses a partial normalizer. Safe executable recursion does not guarantee that every type-level check finishes. Node must supervise compiler work with an external deadline as well as supervising evaluator work. [B10]

## 3. Relevant projects and transferable mechanisms

The projects below cover compilation, live values, ownership, execution protocols, and compiler embedding. No single project implements the entire combination required by Bend.

### Node and compile-to-JavaScript projects

| Project | What it accomplishes | What BendFlow can take | Remaining difference |
| --- | --- | --- | --- |
| ClojureScript Node REPL [P1] | Compiles forms and sends generated JS to a persistent Node evaluator over a socket | Separate setup, compilation, loading, evaluation, and teardown | It has no affine dependent session context |
| tslab [P2] | Compiles TypeScript cells against previous declarations and retains actual values in an `exports` object | Separate compiler declarations from runtime bindings, with generated cross-cell references | Copying references into a shared object is insufficient for Bend ownership |
| IJavascript and NEL [P3] | Provide a persistent Node subprocess, queued execution, IPC, output routing, and a transpilation hook | Evaluator process ownership and asynchronous execution messages | A transpilation hook does not construct Bend's typing context |
| ts-node REPL [P4] | Accumulates virtual source, recompiles, diffs emitted JS, and evaluates added chunks in a persistent context | Demonstrates that recompilation need not replay unchanged execution | Textual output diffing is a weak boundary for ownership-aware Bend cells |
| PureScript PSCi [P5] | Retains imports and declarations and generates a synthetic module for the current expression | Whole-program checking with a generated expression entry point | Its current Node backend starts a fresh process per expression, so live values do not persist |
| CoffeeScript REPL [P6] | Replaces Node's evaluator and cooperates with the compiler on shared scope and result capture | A small example of compiler support for interactive submissions | It does not maintain Bend's static relationships |
| ReScript playground compiler [P7] | Exposes compilation and diagnostics through a JS API, with fresh compilation state | Compiler embedding and structured feedback | A reusable compiler API is not an incremental environment |

ClojureScript is the closest overall host architecture. Its evaluation-environment protocol separates `setup`, `evaluate`, `load`, and `tear-down`. Its Node implementation starts the process during setup and sends subsequent evaluation messages over the retained connection. [P1]

tslab is the clearest example of two distinct stores. Previous declarations support checking the next cell. The persistent `exports` object holds actual values. Bend needs the same separation, with ownership and dependent identities added to the binding records. [P2]

PSCi offers a useful initial compilation strategy because it constructs a synthetic module instead of requiring an interpreter. Its persistence claim must remain precise. It remembers declarations, but its Node backend executes each expression in a new process. This reconstructs the current program rather than retaining earlier computed objects. [P5]

### Native and embedded-language projects

| Project | What it accomplishes | What BendFlow can take | Remaining difference |
| --- | --- | --- | --- |
| evcxr for Rust [P8] | Compiles wrapper functions into shared libraries, loads them in a persistent subprocess, and transfers variables through a runtime store | Ownership-aware input removal, returned-value storage, and a native-loading model | Bend lacks the corresponding shared-runtime ABI and has dependent types |
| GHCi [P9] | Maintains an interactive compiler context and live bindings using interpreted and compiled code | Type-aware sessions and explicit reload boundaries | Its existing interactive engine is not available in Bend |
| ghcid [P10] | Supervises GHCi and requests reloads after file changes | Compiler feedback and worker supervision | It depends on GHCi rather than creating a new evaluator |
| Cling and xeus-cling [P11] | Provide incremental native compilation and a persistent C++ interpreter exposed through notebook messages | Native code loading and the separation of interpreter from frontend | Generated Bend C still needs runtime and layout compatibility |
| Elixir IEx [P12] | Retains runtime bindings, compiler environment, and history after each evaluation | An explicit session API returning updated bindings and environment | Elixir already exposes the required evaluation operation |
| Clojure and nREPL [P13] | Compile forms in a persistent JVM and expose sessions with serialized, multi-message execution | Session lifecycle and request completion messages | Session bindings do not isolate all global namespaces or objects |
| IPython and ipykernel [P14] | Execute cells in retained Python namespaces and expose them through Jupyter | Input completeness, result display, diagnostics, and output attribution | Python already provides a persistent evaluator |
| Pyodide in Node [P15] | Embeds CPython through WebAssembly and retains Python globals across evaluations | A host-managed persistent language runtime | Compiling Bend to another target alone would not provide an evaluator or loader |

evcxr is the strongest ownership precedent. Its generated wrappers move variables out of a runtime map and store surviving variables afterward. Compilation feedback helps identify moved values and actual types. User code executes in a subprocess that loads generated shared libraries. [P8]

GHCi shows that a useful typed REPL can have explicit discontinuities. Operations such as `:reload` discard prompt bindings. BendFlow can use similarly explicit reload boundaries instead of promising transparent replacement of incompatible values. [P9]

Jupyter and nREPL offer protocol ideas rather than a solution to type checking. A submission can produce multiple output messages followed by completion. Output needs a parent submission ID. Execution status, results, diagnostics, and streams need distinct message types. A full Jupyter implementation is optional. [P13, P14]

### Direct Bend projects

| Project | What it accomplishes | What BendFlow can take | Persistence limit |
| --- | --- | --- | --- |
| Bend pocket workshop [P16] | Embeds checking and compilation with virtual files, cached Base, and a persistent compiler worker | Source maps, virtual files, Base reuse, and compiler-execution separation | It creates fresh user books and fresh execution workers, not a live cross-cell binding store |
| bend2-lsp [P17] | Analyzes unsaved source graphs for diagnostics, hover, completion, and navigation | Import overlays and checked type metadata | Its analysis path creates a fresh book and does not execute cells |

These projects are useful compiler-adapter precedents. The inspected workshop and language server use compiler revisions different from the BendFlow pin. Their adapters need version review before reuse. [P16, P17]

## 4. Recommended hybrid model

### Composition

The strongest model combines:

| Source | Role in the proposed REPL |
| --- | --- |
| ClojureScript | Separate compiler sessions from evaluation targets |
| PSCi | Generate a complete compilation unit for each submission |
| tslab | Separate remembered declarations from actual retained values |
| evcxr | Transfer affine values into cells and store returned ownership |
| NEL, nREPL, and Jupyter | Supervise execution and associate streamed responses with submissions |
| Bend's checker | Validate dependent signatures, affine use, and output relationships |
| BendFlow's native worker | Execute compiled native applications and supported native snapshots |

The initial target is a pure, append-only Bend REPL with explicit annotations and a persistent JS evaluator. Native execution uses a separate, explicit build and reload operation. General live native loading remains a later compiler and runtime project.

### Node receives both code and data

```text
External service, CLI, or notebook
    |
    | Bend source, typed data, binding IDs, session revision
    v
Node gateway
    public schemas, session lookup, admission, output routing
    |
    v
Node session controller
    accepted compiler revision and binding metadata
    |
    +----> Compiler worker
    |        candidate book and generated transition
    |        Bend checking and backend emission
    |        returns diagnostics or checked artifact
    |
    +----> Persistent JS evaluator child
    |        loaded code generations and actual values
    |        executes checked transitions
    |
    +----> Native Bend worker
             fixed compiled sessions or rebuilt snapshots
             native state, CPU parallelism, and supported GPU work
    |
    v
Results, diagnostics, output events, and new binding IDs
```

Node is the only public entry point. A caller does not load generated modules or connect directly to Bend's worker. Compiler and evaluator communication also passes through Node's session controller.

The following JSON illustrates a proposed submission envelope. It is not an existing endpoint contract:

```json
{
	"sessionId": "s1",
	"expectedRevision": 3,
	"kind": "evaluate",
	"source": "(left + right : U32)",
	"resultType": "U32",
	"inputs": [
		{"name": "left", "type": "U32", "value": 7},
		{"name": "right", "bindingId": "b12"}
	],
	"retainResultAs": "total"
}
```

Node parses and validates the external data. The compiler parses source and type annotations as Bend syntax. An annotation is a claim to check, not permission to reinterpret an existing value. Node resolves `b12` to authoritative type, generation, and availability metadata before generating the cell.

Definition submissions can carry source fragments or a virtual file map with an entry file. Evaluation submissions can combine new data with retained bindings. Inspection and reset operations use the same session interface.

The existing small frame limit is insufficient for realistic source files and collections. The REPL needs separately bounded source and data sizes, with a versioned compiler-artifact channel or bounded chunking. Code bytes are compiler input, not an operation ID that the native dispatcher can execute directly.

### Two stores with one consistent session revision

The compiler session retains accepted declarations, checked types, template instances, stable binding identities, and erased dependencies. The runtime store retains actual values under those identities.

A binding record needs its Bend type, quantity, availability, defining generation, and evaluator identity. An external binding ID names that record. Possessing the ID does not restore consumed ownership.

Reusable data and affine values follow different rules. Reusable bindings require the declared and checked quantity. Affine bindings leave the available store when execution takes ownership. If the transition returns the resource, the returned binding becomes available under the resulting session revision.

Consumed indices may remain in the compiler context as erased dependencies. Their runtime values need not remain available. Later source resolves the same display name to a stable identity or an explicitly new version.

### Generated transitions enforce the session boundary

Each cell has the conceptual form:

```text
cell_k(available inputs, erased dependencies)
    -> result and retained or newly created bindings
```

The adapter generates an ordinary dependent parameter telescope and a complete output type. `book_valid` checks the signature and body. Lambda closure verifies input usage. Constructor or dependent-pair checking verifies retained output relationships.

An input cannot be consumed by the computation and also retained implicitly. Retention must appear in the generated transition's outputs, or follow an explicitly checked reusable-data rule. Bindings outside the cell's input set remain in the runtime store and cannot be reached through hidden generated references.

A user function that captures an affine session value creates an owned closure. The captured value must transfer into that closure. The adapter cannot implement capture by giving every generated module unrestricted access to a global JS dictionary.

This design keeps Bend's checker authoritative. A lower-level adapter could instead retain `Ctx`, inspect `Uses`, and call `uses_close` for every session binder. That approach also needs context-formation and dependency checks. Complete generated functions reduce the amount of checking policy duplicated in Node.

### Submission lifecycle

The proposed lifecycle has these stages:

1. Node resolves the session and expected revision and admits one active submission.
2. Node validates external data and resolves retained binding IDs.
3. The compiler worker forks the accepted book and generates the candidate transition.
4. The checker validates new events after the accepted prefix and rejects incomplete executable code.
5. The compiler emits a callable artifact for the selected target.
6. The evaluator takes the declared inputs and executes the cell once.
7. The evaluator returns the result and the new binding inventory.
8. Node records the accepted candidate and resulting runtime revision and emits completion.

Declaration-only submissions can commit after checking because they create no runtime value. Evaluation submissions must account for the outcome of execution as well as checking.

Compile rejection leaves the accepted session intact. Runtime failure is different. The cell may already have consumed an input, mutated an array, or performed an effect. The session cannot claim rollback unless the execution design establishes it.

An infrastructure failure after dispatch reports uncertain completion and invalidates affected runtime bindings or the entire evaluator generation. Automatic replay is inappropriate for effectful or ownership-changing cells. A hard timeout destroys the evaluator's live state. These semantics extend the native worker's existing deadline model.

### Data conversion and result display

External callers send first-order values through typed codecs. Node never accepts a native pointer, constructor ID, descriptor, or raw closure as an application value. Affine resources remain in their evaluator and cross the public API as binding IDs.

Dependent inputs need more than a JSON schema. The adapter must represent runtime constraints in the generated checked call, validate them with a checked decoder, or return an explicit constraint failure. An arbitrary client-provided proof field is not evidence that a dependent requirement holds.

A result can contain a bounded display value, its checked type description, and a retained binding ID. A first-order `Data` result can have a validated display copy. An affine result can have an opaque description. A richer inspection operation must preserve or explicitly consume ownership.

### JS execution first, native snapshots separately

The JS evaluator loads emitted library generations and invokes their cell functions. Type-directed adapters mediate values crossing generations. The initial supported set is concrete first-order data. Dependent values and affine closures follow after their metadata and ownership transitions have verification.

Native execution compiles the accepted source into a worker with the required dispatcher and codecs. The worker runs repeated calls through the existing Node transport. New source triggers a new build and an explicit reload boundary.

Restoration across native reloads applies only to a supported serializable schema. Native closures and handles remain in their original runtime and cannot move through ordinary JSON or bytes. JS and native profiles need capability checks because their effects and numeric behavior can differ. The JS profile also remains sequential.

Uninterrupted live native loading would require loadable compilation units, a stable callable ABI, one shared runtime and allocator, compatible type and function identities, ownership-aware handles, and code lifetime management. GPU support adds runtime integration requirements. evcxr is the best precedent for that later work, but its loader is not a drop-in solution for Bend.

### Research questions before implementation

The highest-value verification work is:

- Generate consecutive cells that consume, retain, and return affine values, and prove that the actual evaluator inventory matches the checked transition.
- Preserve an erased dependency across several cells and reject a changed index without suitable evidence.
- Establish which first-order values can cross emitted JS generations and how old closures retain their code.
- Reject a compiler candidate after template instantiation without changing the accepted session.
- Submit code and data from a separate Node client and verify the resulting Bend computation.
- Resolve two submissions against the same expected revision and ensure that only the admitted transition executes.
- Observe a runtime failure after ownership transfer and report the correct binding availability.
- Rebuild a native snapshot and restore only the supported data, with explicit rejection of non-transferable values.

The checker probes establish a viable checking boundary. The remaining proof obligation is the correspondence between that boundary and actual runtime ownership. A persistent Node evaluator alone does not establish that correspondence.

## Sources

### Bend

- [B1] [Theory, affine quantities, erased regions, and safety conditions](https://github.com/bendlang/bend/blob/f0cf0a7c573145501981c44d9c33e326185f008e/bend2/bend.ts#L160-L238).
- [B2] [Context and checking result representations](https://github.com/bendlang/bend/blob/f0cf0a7c573145501981c44d9c33e326185f008e/bend2/bend.ts#L269-L352), [dependent checking rules](https://github.com/bendlang/bend/blob/f0cf0a7c573145501981c44d9c33e326185f008e/bend2/bend.ts#L3397-L3564).
- [B3] [Declaration parsing](https://github.com/bendlang/bend/blob/f0cf0a7c573145501981c44d9c33e326185f008e/bend2/bend.ts#L2525-L2691), [template instantiation and cache](https://github.com/bendlang/bend/blob/f0cf0a7c573145501981c44d9c33e326185f008e/bend2/bend.ts#L3878-L3913).
- [B4] [Incremental book validation](https://github.com/bendlang/bend/blob/f0cf0a7c573145501981c44d9c33e326185f008e/bend2/bend.ts#L3918-L4021).
- [B5] [Released limitations](https://github.com/bendlang/bend/blob/f0cf0a7c573145501981c44d9c33e326185f008e/README.md#limitations), [native library target and runtime constraints](https://github.com/bendlang/bend/blob/f0cf0a7c573145501981c44d9c33e326185f008e/WONTFIX.txt).
- [B6] [Quantity and usage operations](https://github.com/bendlang/bend/blob/f0cf0a7c573145501981c44d9c33e326185f008e/bend2/bend.ts#L611-L647), [binder closure and transition checking](https://github.com/bendlang/bend/blob/f0cf0a7c573145501981c44d9c33e326185f008e/bend2/bend.ts#L3606-L3792).
- [B7] [CLI validation, completeness gate, and book seeding](https://github.com/bendlang/bend/blob/f0cf0a7c573145501981c44d9c33e326185f008e/bend2/main.ts#L1051-L1090).
- [B8] [TODO parsing](https://github.com/bendlang/bend/blob/f0cf0a7c573145501981c44d9c33e326185f008e/bend2/bend.ts#L2035-L2041), [hole checking](https://github.com/bendlang/bend/blob/f0cf0a7c573145501981c44d9c33e326185f008e/bend2/bend.ts#L3809-L3816).
- [B9] [JS library emission and host conversion](https://github.com/bendlang/bend/blob/f0cf0a7c573145501981c44d9c33e326185f008e/bend2/comp.ts#L3075-L3129), [host interop guide](https://github.com/bendlang/bend/blob/f0cf0a7c573145501981c44d9c33e326185f008e/guide/GUIDE.md#L408-L417), [JavaScript compilation reference](https://bend2.dev/learn/compile-to-javascript/).
- [B10] [Partial normalization and sharing cells](https://github.com/bendlang/bend/blob/f0cf0a7c573145501981c44d9c33e326185f008e/bend2/bend.ts#L2880-L3027), [dependent conversion](https://github.com/bendlang/bend/blob/f0cf0a7c573145501981c44d9c33e326185f008e/bend2/bend.ts#L3170-L3327).

### Comparable projects

- [P1] [ClojureScript REPL architecture](https://clojurescript.org/reference/repl), [Node setup and evaluation](https://github.com/clojure/clojurescript/blob/f43d3c81a77f4d417323837518d21521e4d26189/src/main/clojure/cljs/repl/node.clj), [persistent Node evaluator](https://github.com/clojure/clojurescript/blob/f43d3c81a77f4d417323837518d21521e4d26189/src/main/clojure/cljs/repl/node_repl.js).
- [P2] [tslab converter](https://github.com/yunabe/tslab/blob/master/src/converter.ts), [executor and retained exports](https://github.com/yunabe/tslab/blob/master/src/executor.ts).
- [P3] [IJavascript](https://github.com/n-riesco/ijavascript), [NEL session management](https://github.com/n-riesco/nel/blob/master/lib/nel.js), [NEL evaluator](https://github.com/n-riesco/nel/blob/master/lib/server/main.js).
- [P4] [ts-node REPL implementation](https://github.com/TypeStrong/ts-node/blob/main/src/repl.ts).
- [P5] [PSCi declaration and expression handling](https://github.com/purescript/purescript/blob/17d1ec1f587071bd44f3aae78ad6c65f0d7b9342/src/Language/PureScript/Interactive.hs), [synthetic module](https://github.com/purescript/purescript/blob/17d1ec1f587071bd44f3aae78ad6c65f0d7b9342/src/Language/PureScript/Interactive/Module.hs), [Node backend](https://github.com/purescript/purescript/blob/17d1ec1f587071bd44f3aae78ad6c65f0d7b9342/app/Command/REPL.hs#L105-L124).
- [P6] [CoffeeScript REPL](https://github.com/jashkenas/coffeescript/blob/master/src/repl.coffee).
- [P7] [ReScript playground compiler](https://github.com/rescript-lang/rescript/blob/master/compiler/jsoo/jsoo_playground_main.ml).
- [P8] [How evcxr works](https://github.com/evcxr/evcxr/blob/main/evcxr/HOW_IT_WORKS.md), [runtime variable store](https://github.com/evcxr/evcxr/blob/main/evcxr/src/evcxr_internal_runtime.rs).
- [P9] [GHCi user guide](https://downloads.haskell.org/ghc/latest/docs/users_guide/ghci.html).
- [P10] [ghcid](https://github.com/ndmitchell/ghcid).
- [P11] [Cling](https://github.com/root-project/cling), [xeus-cling interpreter](https://github.com/jupyter-xeus/xeus-cling/blob/master/src/xinterpreter.cpp).
- [P12] [IEx evaluator](https://github.com/elixir-lang/elixir/blob/main/lib/iex/lib/iex/evaluator.ex).
- [P13] [Clojure evaluation](https://clojure.org/reference/evaluation), [nREPL design](https://docs.nrepl.org/nrepl/design/overview.html), [nREPL session implementation](https://github.com/nrepl/nrepl/blob/master/src/clojure/nrepl/middleware/session.clj).
- [P14] [IPython execution](https://ipython.readthedocs.io/en/stable/development/execution.html), [ipykernel](https://github.com/ipython/ipykernel/blob/main/ipykernel/ipkernel.py), [Jupyter messaging](https://jupyter-client.readthedocs.io/en/stable/messaging.html).
- [P15] [Pyodide in Node](https://pyodide.org/en/stable/usage/index.html#node-js), [Python globals access](https://pyodide.org/en/stable/usage/quickstart.html#accessing-python-scope-from-javascript), [console implementation](https://github.com/pyodide/pyodide/blob/main/src/py/pyodide/console.py).
- [P16] [Bend pocket workshop](https://np.github.io/bend-workshop/), [compiler adapter](https://github.com/np/bend-workshop/blob/b36db1cbb401820a9d3cd21d429d7e7777a113eb/core/entry.ts), [execution workers](https://github.com/np/bend-workshop/blob/b36db1cbb401820a9d3cd21d429d7e7777a113eb/src/app.js#L1373-L1428).
- [P17] [bend2-lsp](https://github.com/don2e4/bend2-lsp), [analysis worker](https://github.com/don2e4/bend2-lsp/blob/382936b01d92576d8c9a64626b5118d7b6643e25/src/analysis-worker.ts#L508-L566).
