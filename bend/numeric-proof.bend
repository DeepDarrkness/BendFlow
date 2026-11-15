import Base
import ./numeric-core.bend as Core
import ./numeric-laws.bend as Laws

def le_sound(value: Nat, limit: Nat, p: Core.Holds(Nat.is_le(value, limit))) -> Core.LE(value, limit):
  match value limit:
    case 0n other: Unit{}
    case 1n+v 0n:
      match p:
    case 1n+v 1n+b: le_sound(v, b, p)

def and_left(a: Bool, b: Bool, p: Core.Holds(Bool.and(a, b))) -> Core.Holds(a):
  match a:
    case False{}:
      match p:
    case True{}: Unit{}

def and_right(a: Bool, b: Bool, p: Core.Holds(Bool.and(a, b))) -> Core.Holds(b):
  match a:
    case False{}:
      match p:
    case True{}: p

def holds_true(+ok: Bool, e: {ok == True{} : Bool}) -> Core.Holds(ok):
  %Equal.sym(Bool, ok, True{}, e) : Core.Holds(_)
  Unit{}

def checked_bounds(ok: Bool, +limit: Nat, +nat: Nat, +total: Nat, +count: Nat, +bits: U32, +amount: Nat, p: Core.Bounds(limit, Core.Numeric{nat, total, count, bits}), e: {Core.guard(limit, total, count, amount) == ok : Bool}) -> Core.Bounds(limit, Core.state(Core.checked(ok, Core.Numeric{nat, total, count, bits}, amount))):
  match ok:
    case False{}: p
    case True{}:
      +admitted = holds_true(Core.guard(limit, total, count, amount), e)
      (le_sound(Nat.add(total, amount), limit, and_left(Nat.is_le(Nat.add(total, amount), limit), Nat.is_le(1n+count, limit), admitted)), le_sound(1n+count, limit, and_right(Nat.is_le(Nat.add(total, amount), limit), Nat.is_le(1n+count, limit), admitted)))

def Laws.initial_bounds(limit):
  (Unit{}, Unit{})

def Laws.add_preserves_bounds(limit, s, amount, p):
  match s:
    case Core.Numeric{nat, total, count, bits}:
      checked_bounds(Core.guard(limit, total, count, amount), limit, nat, total, count, bits, amount, p, {==})

def checked_admission(ok: Bool, s: Core.State, amount: Nat) -> {Core.accepted(Core.checked(ok, s, amount)) == ok : Bool}:
  match ok:
    case False{}: {==}
    case True{}:
      match s:
        case Core.Numeric{nat, total, count, bits}: {==}

def Laws.guard_admission(limit, nat, total, count, bits, amount):
  checked_admission(Core.guard(limit, total, count, amount), Core.Numeric{nat, total, count, bits}, amount)

def Laws.rejection_preserves_state(limit, nat, total, count, bits, amount, rejected):
  %Equal.sym(Bool, Core.guard(limit, total, count, amount), False{}, rejected) : {Core.checked(_, Core.Numeric{nat, total, count, bits}, amount) == Core.Rejected{Core.Numeric{nat, total, count, bits}} : Core.Outcome}
  {==}

def Laws.acceptance_accumulates(limit, nat, total, count, bits, amount, admitted):
  %Equal.sym(Bool, Core.guard(limit, total, count, amount), True{}, admitted) : {Core.checked(_, Core.Numeric{nat, total, count, bits}, amount) == Core.Accepted{Core.Numeric{nat, Nat.add(total, amount), 1n+count, bits}} : Core.Outcome}
  {==}

def checked_untouched(ok: Bool, +nat: Nat, total: Nat, count: Nat, +bits: U32, amount: Nat) -> {Core.untouched(Core.state(Core.checked(ok, Core.Numeric{nat, total, count, bits}, amount))) == (nat, bits) : Nat & U32}:
  match ok:
    case False{}: {==}
    case True{}: {==}

def Laws.add_untouched_fields(limit, s, amount):
  match s:
    case Core.Numeric{nat, total, count, bits}:
      checked_untouched(Core.guard(limit, total, count, amount), nat, total, count, bits, amount)

def Laws.reset_initial(s):
  {==}

def Laws.reset_idempotent(s):
  {==}

def Laws.word_state_bounds(s, amount, p):
  Laws.add_preserves_bounds(Core.word_max(), s, amount, p)

def successor_exceeds(+limit: Nat) -> {Nat.is_le(1n+limit, limit) == False{} : Bool}:
  match limit:
    case 0n: {==}
    case 1n+p: successor_exceeds(p)

def and_false(a: Bool) -> {Bool.and(a, False{}) == False{} : Bool}:
  match a:
    case False{}: {==}
    case True{}: {==}

def exhausted_guard(+limit: Nat, total: Nat, amount: Nat) -> {Core.guard(limit, total, limit, amount) == False{} : Bool}:
  %Equal.sym(Bool, Nat.is_le(1n+limit, limit), False{}, successor_exceeds(limit)) : {Bool.and(Nat.is_le(Nat.add(total, amount), limit), _) == False{} : Bool}
  and_false(Nat.is_le(Nat.add(total, amount), limit))

def Laws.count_exhaustion_rejects(limit, nat, total, bits, amount):
  Laws.rejection_preserves_state(limit, nat, total, limit, bits, amount, exhausted_guard(limit, total, amount))
