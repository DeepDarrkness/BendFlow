import Base
import ./numeric-core.bend as Core

law initial_bounds:
  for limit: Nat
  Core.Bounds(limit, Core.initial())

law add_preserves_bounds:
  for +limit: Nat
  for +s: Core.State
  for +amount: Nat
  for p: Core.Bounds(limit, s)
  Core.Bounds(limit, Core.state(Core.add(limit, s, amount)))

law guard_admission:
  for +limit: Nat
  for +nat: Nat
  for +total: Nat
  for +count: Nat
  for +bits: U32
  for +amount: Nat
  {Core.accepted(Core.add(limit, Core.Numeric{nat, total, count, bits}, amount)) == Core.guard(limit, total, count, amount) : Bool}

law rejection_preserves_state:
  for +limit: Nat
  for +nat: Nat
  for +total: Nat
  for +count: Nat
  for +bits: U32
  for +amount: Nat
  for rejected: {Core.guard(limit, total, count, amount) == False{} : Bool}
  {Core.add(limit, Core.Numeric{nat, total, count, bits}, amount) == Core.Rejected{Core.Numeric{nat, total, count, bits}} : Core.Outcome}

law acceptance_accumulates:
  for +limit: Nat
  for +nat: Nat
  for +total: Nat
  for +count: Nat
  for +bits: U32
  for +amount: Nat
  for admitted: {Core.guard(limit, total, count, amount) == True{} : Bool}
  {Core.add(limit, Core.Numeric{nat, total, count, bits}, amount) == Core.Accepted{Core.Numeric{nat, Nat.add(total, amount), 1n+count, bits}} : Core.Outcome}

law add_untouched_fields:
  for +limit: Nat
  for +s: Core.State
  for +amount: Nat
  {Core.untouched(Core.state(Core.add(limit, s, amount))) == Core.untouched(s) : Nat & U32}

law reset_initial:
  for s: Core.State
  {Core.reset(s) == Core.initial() : Core.State}

law reset_idempotent:
  for +s: Core.State
  {Core.reset(Core.reset(s)) == Core.reset(s) : Core.State}

law word_state_bounds:
  for +s: Core.State
  for +amount: Nat
  for p: Core.Bounds(Core.word_max(), s)
  Core.Bounds(Core.word_max(), Core.state(Core.add(Core.word_max(), s, amount)))

law count_exhaustion_rejects:
  for +limit: Nat
  for +nat: Nat
  for +total: Nat
  for +bits: U32
  for +amount: Nat
  {Core.add(limit, Core.Numeric{nat, total, limit, bits}, amount) == Core.Rejected{Core.Numeric{nat, total, limit, bits}} : Core.Outcome}
