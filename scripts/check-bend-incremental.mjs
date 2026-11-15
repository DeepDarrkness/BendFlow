import assert from "node:assert/strict";
import * as Bend from "../.toolchain/bend/bend2/bend.ts";

function parse(book, source) {
  Bend.parse_book(book, "", source, "", {});
}

function fork(base) {
  const book = Bend.book_nil();
  for (const k of Object.keys(base.tlds)) {
    book.tlds[k] = { ...base.tlds[k] };
  }
  Object.assign(book.ctrs, base.ctrs);
  for (const k of Object.keys(base.tmps)) {
    book.tmps[k] = new Map(base.tmps[k]);
  }
  book.order.push(...base.order);
  return book;
}

function probe(name, run) {
  run();
  console.log(`PASS: ${name}`);
}

const base = Bend.book_nil();
parse(base, "def f() -> Quant:\n  &1\ndef evidence() -> {f() == &1 : Quant}:\n  {==}\n");
Bend.book_valid(base);
assert.equal(base.hols, 0);
const done = base.order.length;

probe("a complete dependent proof checks without holes", () => {
  assert.ok(base.tlds.evidence.e);
});

probe("fresh extension retains the earlier elaboration", () => {
  const candidate = fork(base);
  const evidence = candidate.tlds.evidence.e;
  parse(candidate, "def later() -> {f() == &1 : Quant}:\n  evidence()\n");
  Bend.book_valid(candidate, done);
  assert.equal(candidate.tlds.evidence.e, evidence);
  assert.ok(candidate.tlds.later.e);
  assert.equal(candidate.hols, 0);
});

probe("ordinary same-name redefinition is rejected by the parser", () => {
  assert.throws(() => parse(fork(base), "def f() -> Quant:\n  &2\n"));
});

probe("a changed body passes a trusted offset but invalidates the old proof on full checking", () => {
  const candidate = fork(base);
  candidate.tlds.f.v = Bend.Qua(Bend.Many());
  Bend.book_valid(candidate, done);
  assert.equal(Bend.term_show(Bend.term_lower(candidate.tlds.f.v)), "&2");
  assert.throws(() => Bend.book_valid(candidate), (error) =>
    error?.$ === "Err" && error.def === "evidence");
});

probe("a rejected isolated candidate leaves the accepted environment usable", () => {
  const candidate = fork(base);
  parse(candidate, "def wrong() -> {f() == &2 : Quant}:\n  {==}\n");
  assert.throws(() => Bend.book_valid(candidate, done));
  assert.equal(base.tlds.wrong, undefined);
  Bend.book_valid(fork(base));
});

probe("TODO acceptance is incomplete rather than a completed proof", () => {
  const candidate = fork(base);
  parse(candidate, "def unfinished() -> {f() == &2 : Quant}:\n  ?TODO\n");
  Bend.book_valid(candidate, done);
  assert.equal(candidate.hols, 1);
});

probe("a named hole fails checking", () => {
  const candidate = fork(base);
  parse(candidate, "def unfinished() -> Quant:\n  ?goal\n");
  assert.throws(() => Bend.book_valid(candidate, done));
});

probe("a law and its implementation are two events checked as one complete submission", () => {
  const candidate = fork(base);
  parse(candidate, "law complete:\n  {f() == &1 : Quant}\ndef complete():\n  {==}\n");
  assert.equal(candidate.order.length, done + 2);
  Bend.book_valid(candidate, done);
  assert.equal(candidate.hols, 0);
  assert.ok(candidate.tlds.complete.e);
});

const dependentSource = "type Witness<-q: Quant> is Data:\n  Witness{}\ntype State is Type:\n  State{q: Quant, w: Witness<q>}\n";

probe("a complete transition preserves a dependent input relationship", () => {
  const candidate = fork(base);
  parse(candidate, dependentSource + "def step(q: Quant, w: Witness<q>) -> State:\n  State{q, w}\ndef later(-q: Quant, w: Witness<q>) -> Witness<q>:\n  w\n");
  Bend.book_valid(candidate, done);
  assert.equal(candidate.hols, 0);
});

probe("a transition cannot return a dependent value at an unrelated index", () => {
  const candidate = fork(base);
  parse(candidate, dependentSource + "def step(q: Quant, w: Witness<q>) -> State:\n  State{&2, w}\n");
  assert.throws(() => Bend.book_valid(candidate, done));
});

probe("an erased index cannot become a live result", () => {
  const candidate = fork(base);
  parse(candidate, "def invalid(-q: Quant) -> Quant:\n  q\n");
  assert.throws(() => Bend.book_valid(candidate, done));
});

probe("a non-descending live recursive definition is rejected", () => {
  const candidate = fork(base);
  parse(candidate, "def loop() -> Quant:\n  loop()\n");
  assert.throws(() => Bend.book_valid(candidate, done));
});
