import Base

def repeat(n: Nat, +value: U32) -> List<&2, U32>:
  match n:
    case 0n:
      []
    case 1n+p:
      value <> repeat(p, value)

def equal(left: List<&2, U32>, right: List<&2, U32>) -> Bool:
  match left right:
    case Nil{} Nil{}:
      True{}
    case a <> tail_a b <> tail_b:
      Bool.and(U32.is_eq(a, b), equal(tail_a, tail_b))
    case other_a other_b:
      False{}

# Test traversal only: the supplied predicate invokes the production parser.
def prefixes(~reject: List<&2, U32> -> Bool, tail: List<&2, U32>, +prefix: List<&2, U32>) -> Bool:
  match tail:
    case Nil{}:
      True{}
    case head <> rest:
      Bool.and(reject(List.reverse(&2, U32, prefix)), prefixes(~reject, rest, head <> prefix))

def strict(~reject: List<&2, U32> -> Bool, +bytes: List<&2, U32>) -> Bool:
  Bool.and(prefixes(~reject, bytes, []), Bool.and(reject(List.append(&2, U32, bytes, [0])), reject(List.append(&2, U32, bytes, [255]))))

def show.go(xs: List<&2, U32>, acc: String) -> String:
  match xs:
    case Nil{}:
      acc ++ "]"
    case head <> rest:
      show.go(rest, acc ++ "," ++ U32.show(head))

def show(xs: List<&2, U32>) -> String:
  match xs:
    case Nil{}:
      "[]"
    case head <> rest:
      show.go(rest, "[" ++ U32.show(head))
