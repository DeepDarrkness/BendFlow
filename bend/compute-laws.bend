import Base
import ./compute-core.bend as Core
import ./compute-order.bend as Order
import ./compute-state.bend as Budget

def tree_count(t: Core.Tree, +key: U32) -> Nat:
  match t:
    case Core.Leaf{xs}:
      Order.count(xs, key)
    case Core.Fork{left, right}:
      Nat.add(tree_count(left, key), tree_count(right, key))

law sort_preservation:
  for +t: Core.Tree
  for +key: U32
  {Order.count(Core.sort(t), key) == tree_count(t, key) : Nat}

law sort_order:
  for t: Core.Tree
  Order.Sorted(Core.sort(t))

law tree_preservation:
  for depth: Nat
  for +xs: List<&2, U32>
  for +key: U32
  {tree_count(Core.tree(depth, xs), key) == Order.count(xs, key) : Nat}

law sort_input_preservation:
  for +depth: Nat
  for +xs: List<&2, U32>
  for +key: U32
  {Order.count(Core.sort(Core.tree(depth, xs)), key) == Order.count(xs, key) : Nat}

law sort_input_order:
  for depth: Nat
  for xs: List<&2, U32>
  Order.Sorted(Core.sort(Core.tree(depth, xs)))

law bounded_plan:
  for +remaining: Nat
  for +requested: Nat
  Budget.PlanValid(remaining, requested, Budget.plan(remaining, requested))

law plan_admission:
  for +remaining: Nat
  for +requested: Nat
  {Budget.allowed(Budget.plan(remaining, requested)) == Nat.is_le(requested, remaining) : Bool}

law advance_velocity:
  for n: Nat
  for +s: Core.Simulation
  {Core.velocity(Core.advance(n, s)) == Core.velocity(s) : U32}

law advance_flags:
  for n: Nat
  for +s: Core.Simulation
  {Core.flags(Core.advance(n, s)) == Core.flags(s) : Bool & Bool}

law reset_initial:
  for s: Core.Simulation
  {Core.reset(s) == Core.initial() : Core.Simulation}

law reset_idempotent:
  for +s: Core.Simulation
  {Core.reset(Core.reset(s)) == Core.reset(s) : Core.Simulation}

law advance_zero:
  for +s: Core.Simulation
  {Core.advance(0n, s) == s : Core.Simulation}

law paused_stable:
  for n: Nat
  for +tick: U32
  for +position: U32
  for +velocity: U32
  for +closed: Bool
  {Core.advance(n, Core.Simulation{tick, position, velocity, False{}, closed}) == Core.Simulation{tick, position, velocity, False{}, closed} : Core.Simulation}

law closed_stable:
  for n: Nat
  for +tick: U32
  for +position: U32
  for +velocity: U32
  for +running: Bool
  {Core.advance(n, Core.Simulation{tick, position, velocity, running, True{}}) == Core.Simulation{tick, position, velocity, running, True{}} : Core.Simulation}

law close_idempotent:
  for +s: Core.Simulation
  {Core.event(Close{}, Core.event(Close{}, s)) == Core.event(Close{}, s) : Core.Simulation}
