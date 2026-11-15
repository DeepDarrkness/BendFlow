import Base
import ./compute-order.bend as Order

def left_lt(x: Cmp) -> Order.Consistent(x, LT{}, LT{}):
  match x:
    case LT{}:
      Unit{}
    case EQ{}:
      Unit{}
    case GT{}:
      Unit{}

def left_gt(x: Cmp) -> Order.Consistent(x, GT{}, GT{}):
  match x:
    case LT{}:
      Unit{}
    case EQ{}:
      Unit{}
    case GT{}:
      Unit{}

def middle_lt(y: Cmp) -> Order.Consistent(LT{}, y, LT{}):
  match y:
    case LT{}:
      Unit{}
    case EQ{}:
      Unit{}
    case GT{}:
      Unit{}

def middle_gt(y: Cmp) -> Order.Consistent(GT{}, y, GT{}):
  match y:
    case LT{}:
      Unit{}
    case EQ{}:
      Unit{}
    case GT{}:
      Unit{}

def bits(a: Bool, b: Bool, c: Bool) -> Order.Consistent(Bool.cmp(a, b), Bool.cmp(b, c), Bool.cmp(a, c)):
  match a b c:
    case False{} False{} False{}:
      Unit{}
    case False{} False{} True{}:
      Unit{}
    case False{} True{} False{}:
      Unit{}
    case False{} True{} True{}:
      Unit{}
    case True{} False{} False{}:
      Unit{}
    case True{} False{} True{}:
      Unit{}
    case True{} True{} False{}:
      Unit{}
    case True{} True{} True{}:
      Unit{}

def step(x: Cmp, y: Cmp, z: Cmp, a: Bool, b: Bool, c: Bool, p: Order.Consistent(x, y, z)) -> Order.Consistent(Word.cmp.fin(a, b, x), Word.cmp.fin(b, c, y), Word.cmp.fin(a, c, z)):
  match x y z:
    case EQ{} EQ{} EQ{}:
      bits(a, b, c)
    case EQ{} LT{} LT{}:
      left_lt(Bool.cmp(a, b))
    case EQ{} GT{} GT{}:
      left_gt(Bool.cmp(a, b))
    case LT{} EQ{} LT{}:
      middle_lt(Bool.cmp(b, c))
    case GT{} EQ{} GT{}:
      middle_gt(Bool.cmp(b, c))
    case LT{} LT{} LT{}:
      Unit{}
    case GT{} GT{} GT{}:
      Unit{}
    case LT{} GT{} LT{}:
      Unit{}
    case LT{} GT{} EQ{}:
      Unit{}
    case LT{} GT{} GT{}:
      Unit{}
    case GT{} LT{} LT{}:
      Unit{}
    case GT{} LT{} EQ{}:
      Unit{}
    case GT{} LT{} GT{}:
      Unit{}
    case EQ{} EQ{} LT{}:
      match p:
    case EQ{} EQ{} GT{}:
      match p:
    case EQ{} LT{} EQ{}:
      match p:
    case EQ{} LT{} GT{}:
      match p:
    case EQ{} GT{} EQ{}:
      match p:
    case EQ{} GT{} LT{}:
      match p:
    case LT{} EQ{} EQ{}:
      match p:
    case LT{} EQ{} GT{}:
      match p:
    case GT{} EQ{} EQ{}:
      match p:
    case GT{} EQ{} LT{}:
      match p:
    case LT{} LT{} EQ{}:
      match p:
    case LT{} LT{} GT{}:
      match p:
    case GT{} GT{} EQ{}:
      match p:
    case GT{} GT{} LT{}:
      match p:

def consistent(+n: Nat, +a: Word(n), +b: Word(n), +c: Word(n)) -> Order.Consistent(Word.cmp(n, a, b), Word.cmp(n, b, c), Word.cmp(n, a, c)):
  match n:
    case 0n:
      Unit{}
    case 1n+p:
      match a b c:
        case WCon{ab, at} WCon{bb, bt} WCon{cb, ct}:
          step(Word.cmp(p, at, bt), Word.cmp(p, bt, ct), Word.cmp(p, at, ct), ab, bb, cb, consistent(p, at, bt, ct))

def bool_refl(b: Bool) -> {Bool.cmp(b, b) == EQ{} : Cmp}:
  match b:
    case False{}:
      {==}
    case True{}:
      {==}

def refl(n: Nat, a: Word(n)) -> {Word.cmp(n, a, a) == EQ{} : Cmp}:
  match n:
    case 0n:
      {==}
    case 1n+p:
      match a:
        case WCon{ab, at}:
          %Equal.sym(Cmp, Word.cmp(p, at, at), EQ{}, refl(p, at)) : {Word.cmp.fin(ab, ab, _) == EQ{} : Cmp}
          bool_refl(ab)

def u32_consistent(+a: U32, +b: U32, +c: U32) -> Order.Consistent(U32.cmp(a, b), U32.cmp(b, c), U32.cmp(a, c)):
  match a b c:
    case U32{x} U32{y} U32{z}:
      consistent(32n, x, y, z)

def u32_refl(a: U32) -> {U32.cmp(a, a) == EQ{} : Cmp}:
  match a:
    case U32{x}:
      refl(32n, x)

def trans_cmp(x: Cmp, y: Cmp, z: Cmp, p: Order.Consistent(x, y, z), ab: Order.Holds(Cmp.is_le(x)), bc: Order.Holds(Cmp.is_le(y))) -> Order.Holds(Cmp.is_le(z)):
  match x y z:
    case LT{} LT{} LT{}:
      Unit{}
    case LT{} EQ{} LT{}:
      Unit{}
    case EQ{} LT{} LT{}:
      Unit{}
    case EQ{} EQ{} EQ{}:
      Unit{}
    case LT{} LT{} EQ{}:
      match p:
    case LT{} LT{} GT{}:
      match p:
    case LT{} EQ{} EQ{}:
      match p:
    case LT{} EQ{} GT{}:
      match p:
    case EQ{} LT{} EQ{}:
      match p:
    case EQ{} LT{} GT{}:
      match p:
    case EQ{} EQ{} LT{}:
      match p:
    case EQ{} EQ{} GT{}:
      match p:
    case LT{} GT{} _:
      match bc:
    case EQ{} GT{} _:
      match bc:
    case GT{} _ _:
      match ab:

def trans(+a: U32, +b: U32, +c: U32, ab: Order.LE(a, b), bc: Order.LE(b, c)) -> Order.LE(a, c):
  trans_cmp(U32.cmp(a, b), U32.cmp(b, c), U32.cmp(a, c), u32_consistent(a, b, c), ab, bc)

def reverse_cmp(x: Cmp, y: Cmp, p: Order.Consistent(x, y, EQ{}), no: Order.Holds(Bool.not(Cmp.is_le(x)))) -> Order.Holds(Cmp.is_le(y)):
  match x y:
    case LT{} _:
      match no:
    case EQ{} _:
      match no:
    case GT{} LT{}:
      Unit{}
    case GT{} EQ{}:
      match p:
    case GT{} GT{}:
      match p:

def self_consistent(+a: U32, +b: U32) -> Order.Consistent(U32.cmp(a, b), U32.cmp(b, a), EQ{}):
  %u32_refl(a) : Order.Consistent(U32.cmp(a, b), U32.cmp(b, a), _)
  u32_consistent(a, b, a)

def reverse(+a: U32, +b: U32, no: Order.Holds(Bool.not(U32.is_le(a, b)))) -> Order.LE(b, a):
  reverse_cmp(U32.cmp(a, b), U32.cmp(b, a), self_consistent(a, b), no)
