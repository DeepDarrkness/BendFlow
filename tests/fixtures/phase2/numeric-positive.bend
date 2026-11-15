import Base
import ../../../bend/numeric.bend as Numeric

def identity(-A: Type, value: A) -> A:
  value

def erased(-bound: Nat, value: U32) -> U32:
  value

def total(state: Numeric.State) -> U32:
  match state:
    case Numeric.Numeric{nat, value, count, bits}: value

def next_state(pair: Numeric.State & List<&2, U32>) -> Numeric.State:
  match pair:
    case (next, reply): identity(Numeric.State, next)

def advance(state: Numeric.State) -> Numeric.State:
  next_state(Numeric.step(state, Numeric.Add{erased(7n, identity(U32, 42))}))

def count_of(state: Numeric.State) -> U32:
  match state:
    case Numeric.Numeric{nat, value, count, bits}: count

def exhausted_count(state: Numeric.State) -> U32:
  count_of(next_state(Numeric.step(state, Numeric.Add{1})))

def main() -> IO(Unit):
  do IO<Unit>:
    IO.print(U32.show(total(advance(identity(Numeric.State, Numeric.initial())))))
    IO.print(U32.show(exhausted_count(Numeric.Numeric{0n, 0, 4294967295, 0})))
