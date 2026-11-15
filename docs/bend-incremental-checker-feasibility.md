# Feasibility of incrementally checked Bend

## Conclusion

**An incrementally checked Bend environment is feasible. Dependent types do not require typed holes for a REPL.** The current checker supports reuse of an unchanged, checked declaration prefix. It does not provide a general edit-aware incremental checker with dependency invalidation.

The distinction that determines feasibility is how definitions change:

- Adding complete definitions under fresh identities fits the existing checker.
- Replacing definitions requires new immutable versions or rechecking affected definitions and proofs.
- Silently changing the meaning of names while keeping old dependent judgments is unsound.

An interactive Bend environment can therefore support expression checking, evaluation, new functions, new types, and completed proofs. Clojure-style replacement of a global function cannot automatically preserve all earlier dependent types and proofs. Requiring those earlier judgments to remain valid is the incompatible part, not interactivity itself.

This report evaluates [the REPL proposal](bend-node-repl.md), Bend's checker, and BendTT. Execution interfaces and native loading are outside this assessment.

## Evidence and scope

Research date: 2026-11-15. The local toolchain is upstream revision `f0cf0a7c573145501981c44d9c33e326185f008e`. The requested `main` BendTT PDF and the pinned PDF were byte-identical at retrieval. Paper references below use its printed page numbers, which match PDF page numbers. [1]

I inspected the parser, incremental validator, dependent inference, hole checking, and normalizer. I also reviewed the paper and kernel validation structure. I ran 12 focused probes against the actual TypeScript checker under Node v24.11.0. The probes are retained in [`scripts/check-bend-incremental.mjs`](../scripts/check-bend-incremental.mjs):

```sh
node scripts/check-bend-incremental.mjs
```

All 12 passed. These probes establish the behaviors listed below, not a complete interactive checker or a cache-correctness theorem. No latency measurements were taken. The Lean mechanization was not independently rebuilt.

## Dependent types permit hole-free interaction

A checker normally establishes a judgment of the form `Γ ⊢ term : type`. An interactive environment retains `Γ`, checks the next submitted term against it, and extends the environment after acceptance. A type may mention a value or function in `Γ`; that relationship does not require the entire program to arrive at once.

BendTT models a book as an ordered list of closed definitions `k : T = t`. Its core syntax contains no hole constructor. A complete expression can be represented as another closed definition referencing earlier definitions. This gives a theoretical basis for incremental extension, provided those earlier references retain their meaning. [1, §4.1, p. 3; Figure 2, p. 4; §5.2, p. 6]

Existing dependent languages demonstrate hole-free interaction:

- Idris2 documents an interactive environment for type checking and evaluation, including `:t plus` and `2+2`. Its hole-editing commands are separate features. [2]
- Agda's maintained editor interface permits type inference and normalization both inside and outside holes. Its command-line interactive mode is marked unmaintained, so the editor is the better evidence. [3]
- Lean provides `#check`, `#eval`, and `#reduce` in source files. Its documentation says it does not provide a separate command prompt. The community Lean REPL does accept complete declarations and proofs in retained environments. Neither mechanism requires unfinished proofs. [4]

Holes help inspect a goal or develop a definition before it is complete. They do not enable incremental checking itself. Type annotations are also different from holes. Bend's bidirectional checker needs an expected type for some terms, including bare lambdas and reflexivity proofs, but a complete annotation supplies that type without unfinished code. [5]

## What the current checker supports

### Reuse of a checked prefix

`book_valid(book, done)` skips signature and body checking for order events before `done`. It reconstructs the declaration environment and restores bodies in event order. The CLI uses this API to check user source after a seeded Base book. [6, 7]

This is genuine reuse of earlier checking work. In the fresh-extension probe, a new dependent proof checked successfully, and the earlier proof's elaborated term retained its object identity.

However, `done` is a caller-supplied trusted offset. The API does not establish that the prefix was checked, remains unchanged, or is complete. `done` counts events, not unique definitions. A `law` declaration and its implementation can occupy two events. Template instances are checked when needed and retained outside the order list. [6, 8]

The reuse rule needs these invariants:

- The prefix has passed checking and the completeness gate.
- Existing types, bodies, constructors, quantities, and resolved identities remain fixed.
- Imported dependencies remain at their accepted versions.
- Previously checked template instances belong to that same environment.
- New declarations use fresh identities. Mutually dependent declarations in erased positions arrive as a complete group when necessary.

The paper permits references in dead positions without the live call-order restriction. Consequently, a future invalidation graph must cover type dependencies as well as executable call dependencies. [1, §4.2, p. 4; §5.2, p. 6]

### Candidate checking needs a commit boundary

Parsing and checking mutate the book. Failure does not roll those changes back. The CLI's `book_seed` copies declaration records and template maps into fresh tables before loading and checking new source. [7, 8]

That is a useful model for fresh additions to a complete prefix. The isolation probe confirmed that a rejected addition did not enter the accepted environment, which remained fully checkable. This limited probe does not establish isolation under arbitrary mutation of shared nested terms or every compiler operation.

For incremental checking, the accepted environment must remain separate from the candidate until validation succeeds. A general editing implementation needs more than treating a shallow copy as an unrestricted snapshot.

### Complete dependent relationships already check

The probes reproduced the proposal's symbolic dependency example:

```bend
type Witness<-q: Quant> is Data:
	Witness{}

type State is Type:
	State{q: Quant, w: Witness<q>}

def step(q: Quant, w: Witness<q>) -> State:
	State{q, w}

def later(-q: Quant, w: Witness<q>) -> Witness<q>:
	w
```

The checker accepted both complete functions. Changing `State{q, w}` to `State{&2, w}` failed. Returning erased `q` as a live result also failed. These checks need no hole construct. [5]

This establishes a useful checking mechanism, but an interactive environment still has to preserve the symbolic index and its dependency across submissions. The checker does not reconstruct arbitrary dependent identities from previously computed runtime objects.

### Affine ownership is an additional session constraint

Bend combines dependency with affine usage. `Ctx` contains binder types and quantities; inference and checking return usage maps. Checking one cell does not automatically change the session context or consume its bindings. [5, 9]

A sequence of cells must track remaining live availability. A consumed name may still be required in a type or erased argument, without becoming available for another live use. Complete generated transition functions can let Bend check each cell's input and output relationships, as the proposal recommends. They do not by themselves implement cross-cell availability.

This constraint comes from Bend's ownership model, not from dependent typing alone. Retained declarations are substantially simpler than retained affine values.

## Redefinition is the main missing capability

Consider this complete checked source:

```bend
def f() -> Quant:
	&1

def evidence() -> {f() == &1 : Quant}:
	{==}
```

`evidence` checks because conversion unfolds `f()` to `&1`. If `f` instead returns `&2`, its signature is unchanged, but the old proof no longer establishes its stated equality. BendTT explicitly uses unfolding in conversion and conversion in reflexivity checking. [1, §4.4–4.5, pp. 4–5; 10]

The current parser rejects an ordinary duplicate `def f`. The probe deliberately bypassed the parser and changed only `f`'s body in a copied book:

- Checking with `book_valid(candidate, done)` returned successfully because the old events were skipped.
- Full checking with `book_valid(candidate)` rejected `evidence`.

This is an API precondition violation, not evidence that ordinary parsing accepts invalid replacement. It proves that the offset is not an invalidation mechanism. [6, 8]

Two policies are feasible:

1. **Immutable versions.** An apparent redefinition creates a fresh internal identity. New submissions resolve the display name to the new version; old checked terms and proofs still refer to the old one. Old behavior remains attached to old references.
2. **Replacement with rechecking.** Build a new environment and recheck affected definitions. A full rebuild is a conservative starting point. Dependency-aware rechecking needs dependencies through signatures, unfolded bodies, constructors, imports, and template instances. Earlier source may now fail and cannot remain accepted in the new environment.

Both permit an interactive workflow. Neither promises that all previously checked proofs survive a semantic change. A mutable global lookup alone cannot enforce these policies because old dependent terms would then acquire new meanings without new checking.

The current sources contain no general dependency invalidation API. Adding one is a checker engineering project. Immutable extension can use the existing API with controlled environment management.

## Holes, termination, and proof guarantees

### Incomplete acceptance must stay separate

The surface checker accepts `?TODO` at any expected type. Parsing records incompleteness in `book.hols`, and the CLI rejects books with outstanding holes. Ordinary named holes fail checking and report the expected goal. An unimplemented ordinary law also counts as incomplete. [7, 11]

The probes confirmed all three relevant behaviors: a complete proof checks without holes, `?TODO` can pass local checking with a nonzero hole count, and a named hole fails checking. A law and its implementation in one submission checked with zero outstanding holes.

An executable accepted prefix should contain completed ordinary definitions and laws. Keeping incomplete drafts is feasible for a proof workbench, but those drafts are not completed proofs. Filling a previously unresolved law changes its unfolding behavior, so that operation cannot inherit the complete-prefix reuse argument unchanged.

### Live termination does not make every type check terminate

BendTT requires live recursive self-calls to descend and prohibits ordinary live mutual recursion. Its termination theorem concerns closed live terms under its stated book conditions. The probe rejected a non-descending live recursive definition. Arbitrary live recursion is not needed for a REPL and is outside those guarantees. [1, §5.2, p. 6; §6.4, p. 7; §7, p. 8]

Dead terms, including type-level computations, can loop. The paper explicitly says conversion is undecidable and describes budget-bounded checking. A correct book may fail because the budget runs out. [1, §3.2, p. 3; §4.6, p. 5]

There is an implementation distinction here. The Lean kernel uses fuel and reports `out of fuel`. The TypeScript `term_wnf` inspected here is a partial normalizer with an unbounded loop, not a guaranteed terminating, fuel-bounded operation. An interactive checker using this API needs externally bounded work or an added internal budget. A timeout or exhausted budget means checking did not finish, not that the source has been proved ill-typed. [10, 12]

### Incrementality has no constant-time guarantee

Skipping old bodies does not mean the next check touches only new source. `book_valid` still scans the order list and declaration table. Dependent comparison can unfold earlier definitions, and a new call can instantiate an earlier template. [6, 8, 10]

Thus a claim that every submission costs only its new text size is unsupported. The paper's single-pass checking structure does not eliminate conversion work or prove edit-aware incremental performance.

### The kernel theorem does not verify this session implementation

The paper's consistency claim applies to the actual core `Book.check`. It explicitly excludes the parser and the TypeScript Bend-to-BendTT translation from the verified portion. `--verdict` checks the translated core book. It does not prove that a new incremental cache, source translation, or execution backend preserves source meaning. [1, §6.5, p. 7; §8, p. 8; 12]

The paper supplies a theoretical basis for immutable extension, but it does not prove the TypeScript offset API or a general incremental-cache theorem. If mechanically verified prefix reuse is a requirement, that property needs its own argument and implementation verification.

## Assessment of `bend-node-repl.md`

The proposal's checker direction is sound within its stated append-only scope. Sections 2 and 4 correctly distinguish usage checking from session updates, require stable identities, identify the trusted offset, and recommend complete transitions.

Its opening statement, "A correctly checked REPL is feasible with the current Bend checker," needs the following qualification:

> The current checker is sufficient for a complete, append-only interactive environment under unchanged-prefix invariants. It does not implement sound same-identity redefinition, dependency invalidation, or cross-cell ownership state.

The proposal also needs a clearer separation between Bend's surface checker and the budgeted, formally verified BendTT kernel. The paper's guarantees cannot be transferred wholesale to an incremental surface session.

The retained-value transition design is plausible, and the dependent probes support its local checking mechanism. The proposal already identifies the remaining session-state correspondence obligation. It would be premature to treat that entire capability as implemented or verified.

## Feasibility judgment

| Desired behavior | Judgment |
| --- | --- |
| Type queries and evaluation of complete, appropriately annotated expressions against accepted definitions | Feasible with existing checking operations and an expression adapter |
| Append complete functions, types, and proofs without rechecking old bodies | Supported by the prefix API under the invariants above |
| Develop incomplete proofs interactively | Feasible as a separate draft environment; holes are optional tooling |
| Reuse display names while old checked terms retain old meanings | Feasible with fresh internal definition versions |
| Edit old definitions and automatically recheck dependents | Feasible in principle; general invalidation and cache management are missing |
| Change a function body but preserve all earlier proofs solely because its type is unchanged | Not sound in general |
| Preserve dependent affine bindings across cells | Plausible with checked transitions and explicit session availability; local checks are demonstrated |
| Guarantee every submission terminates or checking costs only the new source size | Unsupported by the theory and current API |

**Recommendation:** Start with complete, immutable declaration generations, explicit annotations where Bend requires them, isolated candidates, and closed checked expression submissions. Treat edits as new versions or explicit rebuilds. That provides incrementally checked Bend without weakening its type system or relying on holes.

## Primary sources

1. [BendTT paper, pinned revision](https://github.com/bendlang/bend/blob/f0cf0a7c573145501981c44d9c33e326185f008e/paper/BendTT.pdf), and [the requested `main` PDF](https://github.com/bendlang/bend/blob/main/paper/BendTT.pdf).
2. Idris2 [interactive environment](https://idris2.readthedocs.io/en/latest/tutorial/starting.html#the-interactive-environment) and [editing at the REPL](https://idris2.readthedocs.io/en/latest/tutorial/interactive.html#editing-at-the-repl).
3. Agda [global editor commands](https://agda.readthedocs.io/en/latest/tools/emacs-mode.html#global-commands) and [interactive CLI status](https://agda.readthedocs.io/en/latest/tools/command-line-options.html#cmdoption-interactive).
4. [Official Lean interactive commands](https://lean-lang.org/doc/reference/latest/Interacting-with-Lean/) and [community Lean REPL command mode](https://github.com/leanprover-community/repl#command-mode).
5. Bend [dependent inference and annotations](https://github.com/bendlang/bend/blob/f0cf0a7c573145501981c44d9c33e326185f008e/bend2/bend.ts#L3397-L3574).
6. Bend [prefix validation and event semantics](https://github.com/bendlang/bend/blob/f0cf0a7c573145501981c44d9c33e326185f008e/bend2/bend.ts#L3918-L4021).
7. Bend CLI [validation, completeness, and book seeding](https://github.com/bendlang/bend/blob/f0cf0a7c573145501981c44d9c33e326185f008e/bend2/main.ts#L1051-L1090).
8. Bend [fresh names and declaration parsing](https://github.com/bendlang/bend/blob/f0cf0a7c573145501981c44d9c33e326185f008e/bend2/bend.ts#L2525-L2691), and [template instantiation](https://github.com/bendlang/bend/blob/f0cf0a7c573145501981c44d9c33e326185f008e/bend2/bend.ts#L3878-L3913).
9. Bend [context and usage representations](https://github.com/bendlang/bend/blob/f0cf0a7c573145501981c44d9c33e326185f008e/bend2/bend.ts#L268-L352), [usage accounting](https://github.com/bendlang/bend/blob/f0cf0a7c573145501981c44d9c33e326185f008e/bend2/bend.ts#L611-L647), and [theory and guarantee boundaries](https://github.com/bendlang/bend/blob/f0cf0a7c573145501981c44d9c33e326185f008e/bend2/bend.ts#L160-L238).
10. Bend [partial normalization and definition unfolding](https://github.com/bendlang/bend/blob/f0cf0a7c573145501981c44d9c33e326185f008e/bend2/bend.ts#L2880-L3027), and [reflexivity and hole checking](https://github.com/bendlang/bend/blob/f0cf0a7c573145501981c44d9c33e326185f008e/bend2/bend.ts#L3798-L3816).
11. Bend [TODO parsing](https://github.com/bendlang/bend/blob/f0cf0a7c573145501981c44d9c33e326185f008e/bend2/bend.ts#L2035-L2041), plus the completeness gate in source 7.
12. [BendTT Lean kernel](https://github.com/bendlang/bend/blob/f0cf0a7c573145501981c44d9c33e326185f008e/bend2/bendtt.lean), especially fuel-bounded conversion and checking, `Def.check`, `Book.check_from`, and `Book.check`.
