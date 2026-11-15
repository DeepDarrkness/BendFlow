import Base
import ./compute-core.bend as Core
import ./compute-order.bend as Order
import ./compute-state.bend as Budget
import ./compute-comparison-proof.bend as Compare
import ./compute-laws.bend as Laws

def add_zero(a: Nat) -> {Nat.add(a, 0n) == a : Nat}:
  match a:
    case 0n:
      {==}
    case 1n+p:
      %add_zero(p) : {1n+Nat.add(p, 0n) == 1n+_ : Nat}
      {==}

def add_succ(a: Nat, b: Nat) -> {Nat.add(a, 1n+b) == 1n+Nat.add(a, b) : Nat}:
  match a:
    case 0n:
      {==}
    case 1n+p:
      %add_succ(p, b) : {1n+Nat.add(p, 1n+b) == 1n+_ : Nat}
      {==}

def add_comm(+a: Nat, +b: Nat) -> {Nat.add(a, b) == Nat.add(b, a) : Nat}:
  match a:
    case 0n:
      Equal.sym(Nat, Nat.add(b, 0n), b, add_zero(b))
    case 1n+p:
      Equal.trans(Nat, 1n+Nat.add(p, b), 1n+Nat.add(b, p), Nat.add(b, 1n+p), Equal.cong(Nat, Nat, x => 1n+x, Nat.add(p, b), Nat.add(b, p), add_comm(p, b)), Equal.sym(Nat, Nat.add(b, 1n+p), 1n+Nat.add(b, p), add_succ(b, p)))

def add_assoc(+a: Nat, +b: Nat, +c: Nat) -> {Nat.add(Nat.add(a, b), c) == Nat.add(a, Nat.add(b, c)) : Nat}:
  match a:
    case 0n:
      {==}
    case 1n+p:
      Equal.cong(Nat, Nat, x => 1n+x, Nat.add(Nat.add(p, b), c), Nat.add(p, Nat.add(b, c)), add_assoc(p, b, c))

def rotate(+a: Nat, +b: Nat, +c: Nat) -> {Nat.add(a, Nat.add(b, c)) == Nat.add(b, Nat.add(a, c)) : Nat}:
  Equal.trans(Nat, Nat.add(a, Nat.add(b, c)), Nat.add(Nat.add(a, b), c), Nat.add(b, Nat.add(a, c)), Equal.sym(Nat, Nat.add(Nat.add(a, b), c), Nat.add(a, Nat.add(b, c)), add_assoc(a, b, c)), Equal.trans(Nat, Nat.add(Nat.add(a, b), c), Nat.add(Nat.add(b, a), c), Nat.add(b, Nat.add(a, c)), Equal.cong(Nat, Nat, x => Nat.add(x, c), Nat.add(a, b), Nat.add(b, a), add_comm(a, b)), add_assoc(b, a, c)))

def inserted_count(le: Bool, +n: U32, +h: U32, +tail: List<&2, U32>, +added: List<&2, U32>, +key: U32, p: {Order.count(added, key) == Nat.add(Order.weight(U32.is_eq(n, key)), Order.count(tail, key)) : Nat}) -> {Order.count(Core.inserted(le, n, h, tail, added), key) == Nat.add(Order.weight(U32.is_eq(n, key)), Order.count(h <> tail, key)) : Nat}:
  match le:
    case True{}:
      {==}
    case False{}:
      Equal.trans(Nat, Nat.add(Order.weight(U32.is_eq(h, key)), Order.count(added, key)), Nat.add(Order.weight(U32.is_eq(h, key)), Nat.add(Order.weight(U32.is_eq(n, key)), Order.count(tail, key))), Nat.add(Order.weight(U32.is_eq(n, key)), Order.count(h <> tail, key)), Equal.cong(Nat, Nat, x => Nat.add(Order.weight(U32.is_eq(h, key)), x), Order.count(added, key), Nat.add(Order.weight(U32.is_eq(n, key)), Order.count(tail, key)), p), rotate(Order.weight(U32.is_eq(h, key)), Order.weight(U32.is_eq(n, key)), Order.count(tail, key)))

def insert_count(+xs: List<&2, U32>, +n: U32, +key: U32) -> {Order.count(Core.insert(xs, n), key) == Nat.add(Order.weight(U32.is_eq(n, key)), Order.count(xs, key)) : Nat}:
  match xs:
    case Nil{}:
      {==}
    case h <> t:
      inserted_count(U32.is_le(n, h), n, h, t, Core.insert(t, n), key, insert_count(t, n, key))

def merge_count(+xs: List<&2, U32>, +ys: List<&2, U32>, +key: U32) -> {Order.count(Core.merge(xs, ys), key) == Nat.add(Order.count(xs, key), Order.count(ys, key)) : Nat}:
  match xs:
    case Nil{}:
      {==}
    case h <> t:
      %Equal.sym(Nat, Order.count(Core.insert(Core.merge(t, ys), h), key), Nat.add(Order.weight(U32.is_eq(h, key)), Order.count(Core.merge(t, ys), key)), insert_count(Core.merge(t, ys), h, key)) : {_ == Nat.add(Order.count(h <> t, key), Order.count(ys, key)) : Nat}
      %Equal.sym(Nat, Order.count(Core.merge(t, ys), key), Nat.add(Order.count(t, key), Order.count(ys, key)), merge_count(t, ys, key)) : {Nat.add(Order.weight(U32.is_eq(h, key)), _) == Nat.add(Order.count(h <> t, key), Order.count(ys, key)) : Nat}
      Equal.sym(Nat, Nat.add(Order.count(h <> t, key), Order.count(ys, key)), Nat.add(Order.weight(U32.is_eq(h, key)), Nat.add(Order.count(t, key), Order.count(ys, key))), add_assoc(Order.weight(U32.is_eq(h, key)), Order.count(t, key), Order.count(ys, key)))

def Laws.sort_preservation(t, key):
  match t:
    case Core.Leaf{xs}:
      Equal.trans(Nat, Order.count(Core.merge(xs, []), key), Nat.add(Order.count(xs, key), 0n), Order.count(xs, key), merge_count(xs, [], key), add_zero(Order.count(xs, key)))
    case Core.Fork{left, right}:
      %Equal.sym(Nat, Order.count(Core.merge(Core.sort(left), Core.sort(right)), key), Nat.add(Order.count(Core.sort(left), key), Order.count(Core.sort(right), key)), merge_count(Core.sort(left), Core.sort(right), key)) : {_ == Nat.add(Laws.tree_count(left, key), Laws.tree_count(right, key)) : Nat}
      %Laws.sort_preservation(left, key) : {Nat.add(Order.count(Core.sort(left), key), Order.count(Core.sort(right), key)) == Nat.add(_, Laws.tree_count(right, key)) : Nat}
      %Laws.sort_preservation(right, key) : {Nat.add(Order.count(Core.sort(left), key), Order.count(Core.sort(right), key)) == Nat.add(Order.count(Core.sort(left), key), _) : Nat}
      {==}

def partition_count(+xs: List<&2, U32>, +key: U32) -> {Nat.add(Order.count(Core.evens(xs), key), Order.count(Core.odds(xs), key)) == Order.count(xs, key) : Nat}:
  match xs:
    case Nil{}:
      {==}
    case x <> Nil{}:
      add_zero(Order.count([x], key))
    case x <> y <> rest:
      %Equal.sym(Nat, Nat.add(Nat.add(Order.weight(U32.is_eq(x, key)), Order.count(Core.evens(rest), key)), Nat.add(Order.weight(U32.is_eq(y, key)), Order.count(Core.odds(rest), key))), Nat.add(Order.weight(U32.is_eq(x, key)), Nat.add(Order.count(Core.evens(rest), key), Nat.add(Order.weight(U32.is_eq(y, key)), Order.count(Core.odds(rest), key)))), add_assoc(Order.weight(U32.is_eq(x, key)), Order.count(Core.evens(rest), key), Nat.add(Order.weight(U32.is_eq(y, key)), Order.count(Core.odds(rest), key)))) : {_ == Order.count(x <> y <> rest, key) : Nat}
      %Equal.sym(Nat, Nat.add(Order.count(Core.evens(rest), key), Nat.add(Order.weight(U32.is_eq(y, key)), Order.count(Core.odds(rest), key))), Nat.add(Order.weight(U32.is_eq(y, key)), Nat.add(Order.count(Core.evens(rest), key), Order.count(Core.odds(rest), key))), rotate(Order.count(Core.evens(rest), key), Order.weight(U32.is_eq(y, key)), Order.count(Core.odds(rest), key))) : {Nat.add(Order.weight(U32.is_eq(x, key)), _) == Order.count(x <> y <> rest, key) : Nat}
      %partition_count(rest, key) : {Nat.add(Order.weight(U32.is_eq(x, key)), Nat.add(Order.weight(U32.is_eq(y, key)), Nat.add(Order.count(Core.evens(rest), key), Order.count(Core.odds(rest), key)))) == Nat.add(Order.weight(U32.is_eq(x, key)), Nat.add(Order.weight(U32.is_eq(y, key)), _)) : Nat}
      {==}

def Laws.tree_preservation(depth, xs, key):
  match depth:
    case 0n:
      {==}
    case 1n+ +p:
      %Equal.sym(Nat, Laws.tree_count(Core.tree(p, Core.evens(xs)), key), Order.count(Core.evens(xs), key), Laws.tree_preservation(p, Core.evens(xs), key)) : {Nat.add(_, Laws.tree_count(Core.tree(p, Core.odds(xs)), key)) == Order.count(xs, key) : Nat}
      %Equal.sym(Nat, Laws.tree_count(Core.tree(p, Core.odds(xs)), key), Order.count(Core.odds(xs), key), Laws.tree_preservation(p, Core.odds(xs), key)) : {Nat.add(Order.count(Core.evens(xs), key), _) == Order.count(xs, key) : Nat}
      partition_count(xs, key)

def Laws.sort_input_preservation(depth, xs, key):
  Equal.trans(Nat, Order.count(Core.sort(Core.tree(depth, xs)), key), Laws.tree_count(Core.tree(depth, xs), key), Order.count(xs, key), Laws.sort_preservation(Core.tree(depth, xs), key), Laws.tree_preservation(depth, xs, key))

def lower_trans(xs: List<&2, U32>, +n: U32, +h: U32, +nh: Order.LE(n, h), p: Order.Lower(h, xs)) -> Order.Lower(n, xs):
  match xs:
    case Nil{}:
      Unit{}
    case x <> t:
      (hx, ht) = p
      (Compare.trans(n, h, x, nh, hx), lower_trans(t, n, h, nh, ht))

def lower_inserted(le: Bool, +bound: U32, +n: U32, +h: U32, +t: List<&2, U32>, +added: List<&2, U32>, bn: Order.LE(bound, n), bh: Order.LE(bound, h), bt: Order.Lower(bound, t), ba: Order.Lower(bound, added)) -> Order.Lower(bound, Core.inserted(le, n, h, t, added)):
  match le:
    case True{}:
      (bn, (bh, bt))
    case False{}:
      (bh, ba)

def lower_insert(xs: List<&2, U32>, +bound: U32, +n: U32, +bn: Order.LE(bound, n), p: Order.Lower(bound, xs)) -> Order.Lower(bound, Core.insert(xs, n)):
  match xs:
    case Nil{}:
      (bn, Unit{})
    case +h <> +t:
      (+bh, +bt) = p
      lower_inserted(U32.is_le(n, h), bound, n, h, t, Core.insert(t, n), bn, bh, bt, lower_insert(t, bound, n, bn, bt))

def yes(+n: U32, +h: U32, e: {U32.is_le(n, h) == True{} : Bool}) -> Order.LE(n, h):
  %Equal.sym(Bool, U32.is_le(n, h), True{}, e) : Order.Holds(_)
  Unit{}

def no(+n: U32, +h: U32, e: {U32.is_le(n, h) == False{} : Bool}) -> Order.Holds(Bool.not(U32.is_le(n, h))):
  %Equal.sym(Bool, U32.is_le(n, h), False{}, e) : Order.Holds(Bool.not(_))
  Unit{}

def insert_sorted_choice(le: Bool, +n: U32, +h: U32, +t: List<&2, U32>, e: {U32.is_le(n, h) == le : Bool}, +ht: Order.Lower(h, t), st: Order.Sorted(t), added: Order.Sorted(Core.insert(t, n))) -> Order.Sorted(Core.inserted(le, n, h, t, Core.insert(t, n))):
  match le:
    case True{}:
      +nh = yes(n, h, e)
      ((nh, lower_trans(t, n, h, nh, ht)), (ht, st))
    case False{}:
      hn = Compare.reverse(n, h, no(n, h, e))
      (lower_insert(t, h, n, hn, ht), added)

def insert_sorted(+xs: List<&2, U32>, +n: U32, +p: Order.Sorted(xs)) -> Order.Sorted(Core.insert(xs, n)):
  match xs:
    case Nil{}:
      (Unit{}, Unit{})
    case h <> t:
      (+ht, +st) = p
      insert_sorted_choice(U32.is_le(n, h), n, h, t, {==}, ht, st, insert_sorted(t, n, st))

def merge_sorted(xs: List<&2, U32>, +ys: List<&2, U32>, p: Order.Sorted(ys)) -> Order.Sorted(Core.merge(xs, ys)):
  match xs:
    case Nil{}:
      p
    case h <> +t:
      insert_sorted(Core.merge(t, ys), h, merge_sorted(t, ys, p))

def Laws.sort_order(t):
  match t:
    case Core.Leaf{xs}:
      merge_sorted(xs, [], Unit{})
    case Core.Fork{left, +right}:
      merge_sorted(Core.sort(left), Core.sort(right), Laws.sort_order(right))

def Laws.sort_input_order(depth, xs):
  Laws.sort_order(Core.tree(depth, xs))

def plan_step(+r: Nat, +n: Nat, got: Maybe<&2, Nat>, p: Budget.PlanValid(r, n, got)) -> Budget.PlanValid(1n+r, 1n+n, got):
  match got:
    case None{}:
      Unit{}
    case Some{rest}:
      Equal.cong(Nat, Nat, x => 1n+x, Nat.add(n, rest), r, p)

def Laws.bounded_plan(remaining, requested):
  match remaining requested:
    case 0n 0n:
      {==}
    case 0n 1n+p:
      Unit{}
    case 1n+r 0n:
      {==}
    case 1n+r 1n+p:
      plan_step(r, p, Budget.plan(r, p), Laws.bounded_plan(r, p))

def Laws.advance_zero(s):
  {==}

def Laws.plan_admission(remaining, requested):
  match remaining requested:
    case 0n 0n:
      {==}
    case 0n 1n+p:
      {==}
    case 1n+r 0n:
      {==}
    case 1n+r 1n+p:
      Laws.plan_admission(r, p)

def moved_velocity(on: Bool, tick: U32, position: U32, +velocity: U32, running: Bool, closed: Bool) -> {Core.velocity(Core.moved(on, tick, position, velocity, running, closed)) == velocity : U32}:
  match on:
    case False{}:
      {==}
    case True{}:
      {==}

def moved_flags(on: Bool, tick: U32, position: U32, velocity: U32, +running: Bool, +closed: Bool) -> {Core.flags(Core.moved(on, tick, position, velocity, running, closed)) == (running, closed) : Bool & Bool}:
  match on:
    case False{}:
      {==}
    case True{}:
      {==}

def Laws.advance_velocity(n, s):
  match n:
    case 0n:
      {==}
    case 1n+p:
      match s:
        case Core.Simulation{tick, position, velocity, running, closed}:
          Equal.trans(U32, Core.velocity(Core.advance(p, Core.moved(Core.active(running, closed), tick, position, velocity, running, closed))), Core.velocity(Core.moved(Core.active(running, closed), tick, position, velocity, running, closed)), velocity, Laws.advance_velocity(p, Core.moved(Core.active(running, closed), tick, position, velocity, running, closed)), moved_velocity(Core.active(running, closed), tick, position, velocity, running, closed))

def Laws.advance_flags(n, s):
  match n:
    case 0n:
      {==}
    case 1n+p:
      match s:
        case Core.Simulation{tick, position, velocity, running, closed}:
          Equal.trans(Bool & Bool, Core.flags(Core.advance(p, Core.moved(Core.active(running, closed), tick, position, velocity, running, closed))), Core.flags(Core.moved(Core.active(running, closed), tick, position, velocity, running, closed)), (running, closed), Laws.advance_flags(p, Core.moved(Core.active(running, closed), tick, position, velocity, running, closed)), moved_flags(Core.active(running, closed), tick, position, velocity, running, closed))

def Laws.reset_initial(s):
  {==}

def Laws.reset_idempotent(s):
  {==}

def Laws.paused_stable(n, tick, position, velocity, closed):
  match n:
    case 0n:
      {==}
    case 1n+p:
      Laws.paused_stable(p, tick, position, velocity, closed)

def inactive(running: Bool) -> {Core.active(running, True{}) == False{} : Bool}:
  match running:
    case False{}:
      {==}
    case True{}:
      {==}

def closed_step(+tick: U32, +position: U32, +velocity: U32, +running: Bool) -> {Core.moved(Core.active(running, True{}), tick, position, velocity, running, True{}) == Core.Simulation{tick, position, velocity, running, True{}} : Core.Simulation}:
  %Equal.sym(Bool, Core.active(running, True{}), False{}, inactive(running)) : {Core.moved(_, tick, position, velocity, running, True{}) == Core.Simulation{tick, position, velocity, running, True{}} : Core.Simulation}
  {==}

def Laws.closed_stable(n, tick, position, velocity, running):
  match n:
    case 0n:
      {==}
    case 1n+p:
      %Equal.sym(Core.Simulation, Core.moved(Core.active(running, True{}), tick, position, velocity, running, True{}), Core.Simulation{tick, position, velocity, running, True{}}, closed_step(tick, position, velocity, running)) : {Core.advance(p, _) == Core.Simulation{tick, position, velocity, running, True{}} : Core.Simulation}
      Laws.closed_stable(p, tick, position, velocity, running)

def Laws.close_idempotent(s):
  match s:
    case Core.Simulation{tick, position, velocity, running, closed}:
      {==}
