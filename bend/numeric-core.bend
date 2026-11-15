import Base

type State is Data:
  Numeric{nat: Nat, total: Nat, count: Nat, f32_bits: U32}

type Outcome is Data:
  Accepted{state: State}
  Rejected{state: State}

def power_two(bits: Nat) -> Nat:
  match bits:
    case 0n: 1n
    case 1n+p:
      +half = power_two(p)
      Nat.add(half, half)

def word_max() -> Nat:
  Nat.sub(power_two(32n), 1n)

def initial() -> State:
  Numeric{0n, 0n, 0n, 0}

def reset(s: State) -> State:
  initial()

def guard(+limit: Nat, +total: Nat, count: Nat, amount: Nat) -> Bool:
  Bool.and(Nat.is_le(Nat.add(total, amount), limit), Nat.is_le(1n+count, limit))

def checked(ok: Bool, +s: State, amount: Nat) -> Outcome:
  match ok:
    case False{}: Rejected{s}
    case True{}:
      match s:
        case Numeric{nat, total, count, bits}:
          Accepted{Numeric{nat, Nat.add(total, amount), 1n+count, bits}}

def add(+limit: Nat, s: State, +amount: Nat) -> Outcome:
  match s:
    case Numeric{+nat, +total, +count, +bits}:
      checked(guard(limit, total, count, amount), Numeric{nat, total, count, bits}, amount)

def state(outcome: Outcome) -> State:
  match outcome:
    case Accepted{s}: s
    case Rejected{s}: s

def accepted(outcome: Outcome) -> Bool:
  match outcome:
    case Accepted{s}: True{}
    case Rejected{s}: False{}

def untouched(s: State) -> Nat & U32:
  match s:
    case Numeric{nat, total, count, bits}: (nat, bits)

def LE(value: Nat, limit: Nat) -> Type:
  match value limit:
    case 0n other: Unit
    case 1n+p 0n: Empty
    case 1n+p 1n+b: LE(p, b)

def Bounds(+limit: Nat, s: State) -> Type:
  match s:
    case Numeric{nat, total, count, bits}: LE(total, limit) & LE(count, limit)

def Holds(ok: Bool) -> Data:
  match ok:
    case False{}: Empty
    case True{}: Unit
