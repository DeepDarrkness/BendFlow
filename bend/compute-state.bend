import Base

def plan(remaining: Nat, requested: Nat) -> Maybe<&2, Nat>:
  match remaining requested:
    case 0n 0n:
      Some{0n}
    case 0n 1n+p:
      None{}
    case 1n+r 0n:
      Some{1n+r}
    case 1n+r 1n+p:
      plan(r, p)

def allowed(got: Maybe<&2, Nat>) -> Bool:
  match got:
    case None{}:
      False{}
    case Some{rest}:
      True{}

def PlanValid(+remaining: Nat, +requested: Nat, got: Maybe<&2, Nat>) -> Type:
  match got:
    case None{}:
      Unit
    case Some{rest}:
      {Nat.add(requested, rest) == remaining : Nat}
