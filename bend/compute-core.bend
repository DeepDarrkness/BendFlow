import Base

type Tree is Data:
  Leaf{items: List<&2, U32>}
  Fork{left: Tree, right: Tree}

def evens(xs: List<&2, U32>) -> List<&2, U32>:
  match xs:
    case Nil{}:
      []
    case x <> Nil{}:
      [x]
    case x <> y <> rest:
      x <> evens(rest)

def odds(xs: List<&2, U32>) -> List<&2, U32>:
  match xs:
    case x <> y <> rest:
      y <> odds(rest)
    case other:
      []

def tree(depth: Nat, +xs: List<&2, U32>) -> Tree:
  match depth:
    case 0n:
      Leaf{xs}
    case 1n+ +p:
      l r = tree(p, evens(xs)) tree(p, odds(xs))
      Fork{l, r}

def leaf_sum(xs: List<&2, U32>) -> U32:
  match xs:
    case Nil{}:
      0
    case h <> t:
      (h + leaf_sum(t) : U32)

def sum(t: Tree) -> U32:
  match t:
    case Leaf{xs}:
      leaf_sum(xs)
    case Fork{left, right}:
      a b = sum(left) sum(right)
      (a + b : U32)

def inserted(le: Bool, n: U32, h: U32, tail: List<&2, U32>, added: List<&2, U32>) -> List<&2, U32>:
  match le:
    case True{}:
      n <> h <> tail
    case False{}:
      h <> added

def insert(xs: List<&2, U32>, +n: U32) -> List<&2, U32>:
  match xs:
    case Nil{}:
      [n]
    case +h <> +t:
      inserted(U32.is_le(n, h), n, h, t, insert(t, n))

def merge(xs: List<&2, U32>, ys: List<&2, U32>) -> List<&2, U32>:
  match xs:
    case Nil{}:
      ys
    case h <> t:
      insert(merge(t, ys), h)

def sort(t: Tree) -> List<&2, U32>:
  match t:
    case Leaf{xs}:
      merge(xs, [])
    case Fork{left, right}:
      a b = sort(left) sort(right)
      merge(a, b)

def size(t: Tree) -> Nat:
  match t:
    case Leaf{xs}:
      List.length(&2, U32, xs)
    case Fork{left, right}:
      Nat.add(size(left), size(right))

type Simulation is Data:
  Simulation{tick: U32, position: U32, velocity: U32, running: Bool, closed: Bool}

def initial() -> Simulation:
  Simulation{0, 0, 1, True{}, False{}}

def reset(s: Simulation) -> Simulation:
  initial()

def velocity(s: Simulation) -> U32:
  match s:
    case Simulation{tick, position, velocity, running, closed}:
      velocity

def flags(s: Simulation) -> Bool & Bool:
  match s:
    case Simulation{tick, position, velocity, running, closed}:
      (running, closed)

def active(running: Bool, closed: Bool) -> Bool:
  Bool.and(running, Bool.not(closed))

def moved(on: Bool, tick: U32, position: U32, +velocity: U32, running: Bool, closed: Bool) -> Simulation:
  match on:
    case False{}:
      Simulation{tick, position, velocity, running, closed}
    case True{}:
      Simulation{(tick + 1 : U32), ((position + velocity : U32) % 256 : U32), velocity, running, closed}

def advance(n: Nat, state: Simulation) -> Simulation:
  match n:
    case 0n:
      state
    case 1n+p:
      match state:
        case Simulation{tick, position, +velocity, +running, +closed}:
          advance(p, moved(active(running, closed), tick, position, velocity, running, closed))

def key(+down: Bool, space: Bool, right: Bool, state: Simulation) -> Simulation:
  match state:
    case Simulation{tick, position, velocity, +running, closed}:
      Simulation{tick, position, Bool.pick(U32, right, Bool.pick(U32, down, 2, 1), velocity), Bool.pick(Bool, Bool.and(space, down), Bool.not(running), running), closed}

def event(e: Event, state: Simulation) -> Simulation:
  match e:
    case Key{+code, down}:
      key(down, U32.is_eq(code, 32), U32.is_eq(code, 39), state)
    case Focus{on}:
      match state:
        case Simulation{tick, position, velocity, running, closed}:
          Simulation{tick, position, velocity, on, closed}
    case Close{}:
      match state:
        case Simulation{tick, position, velocity, running, closed}:
          Simulation{tick, position, velocity, False{}, True{}}
    case other:
      state

def events(es: List<&2, Event>, state: Simulation) -> Simulation:
  match es:
    case Nil{}:
      state
    case h <> t:
      events(t, event(h, state))

def color(+x: U32, +y: U32, +tick: U32, +position: U32) -> U32:
  +red = ((x + position : U32) % 256 : U32)
  +green = ((y + tick : U32) % 256 : U32)
  +blue = ((x + (17 * y : U32) + (31 * tick : U32) : U32) % 256 : U32)
  (((red << 24n : U32) .|. (green << 16n : U32) .|. (blue << 8n : U32) .|. 255 : U32))

def render(depth: Nat, +x: U32, +y: U32, +side: U32, +tick: U32, +position: U32) -> Image:
  match depth:
    case 0n:
      Pix{color(x, y, tick, position)}
    case 1n+ +p:
      +half = (side / 2 : U32)
      tl tr = render(p, x, y, half, tick, position) render(p, (x + half : U32), y, half, tick, position)
      bl br = render(p, x, (y + half : U32), half, tick, position) render(p, (x + half : U32), (y + half : U32), half, tick, position)
      Qua{tl, tr, bl, br}

def pixels(img: Image) -> List<&2, U32>:
  match img:
    case Pix{color}:
      [color]
    case Qua{tl, tr, bl, br}:
      a b = pixels(tl) pixels(tr)
      c d = pixels(bl) pixels(br)
      List.append(&2, U32, a, List.append(&2, U32, b, List.append(&2, U32, c, d)))

def sample(+index: U32, phase: U32) -> U32:
  +ramp = ((index + phase : U32) % 32 : U32)
  F32.bits((U32.to_f32(ramp) / 16.0 - 1.0 : F32))

def sample_tail(n: Nat, +start: U32, +phase: U32) -> List<&2, U32>:
  match n:
    case 0n:
      []
    case 1n+p:
      sample(start, phase) <> sample_tail(p, (start + 1 : U32), phase)

def samples(depth: Nat, +start: U32, +count: U32, +phase: U32) -> List<&2, U32>:
  match depth:
    case 0n:
      sample_tail(U32.to_nat(count), start, phase)
    case 1n+ +p:
      match count:
        case 0:
          []
        case 1:
          [sample(start, phase)]
        case other:
          +half = (other / 2 : U32)
          a b = samples(p, start, half, phase) samples(p, (start + half : U32), (other - half : U32), phase)
          List.append(&2, U32, a, b)

def image(depth: Nat, x: U32, y: U32, side: U32, tick: U32, position: U32) -> Image:
  render(depth, x, y, side, tick, position)

def buffer(depth: Nat, start: U32, count: U32, phase: U32) -> List<&2, U32>:
  samples(depth, start, count, phase)
