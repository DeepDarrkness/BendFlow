import Base

def Holds(b: Bool) -> Data:
  match b:
    case False{}:
      Empty
    case True{}:
      Unit

def LE(a: U32, b: U32) -> Data:
  Holds(U32.is_le(a, b))

def Consistent(x: Cmp, y: Cmp, z: Cmp) -> Data:
  match x y z:
    case EQ{} EQ{} EQ{}:
      Unit
    case EQ{} LT{} LT{}:
      Unit
    case EQ{} GT{} GT{}:
      Unit
    case LT{} EQ{} LT{}:
      Unit
    case GT{} EQ{} GT{}:
      Unit
    case LT{} LT{} LT{}:
      Unit
    case GT{} GT{} GT{}:
      Unit
    case LT{} GT{} _:
      Unit
    case GT{} LT{} _:
      Unit
    case _ _ _:
      Empty

def Lower(+n: U32, xs: List<&2, U32>) -> Data:
  match xs:
    case Nil{}:
      Unit
    case h <> t:
      Sigma<&2, &2, LE(n, h), _ => Lower(n, t)>

def Sorted(xs: List<&2, U32>) -> Data:
  match xs:
    case Nil{}:
      Unit
    case h <> +t:
      Sigma<&2, &2, Lower(h, t), _ => Sorted(t)>

def weight(eq: Bool) -> Nat:
  match eq:
    case False{}:
      0n
    case True{}:
      1n

def count(xs: List<&2, U32>, +key: U32) -> Nat:
  match xs:
    case Nil{}:
      0n
    case h <> t:
      Nat.add(weight(U32.is_eq(h, key)), count(t, key))
