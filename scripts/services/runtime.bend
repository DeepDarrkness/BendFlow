import Base
import ./bytes.bend as Bytes
import ./utf8.bend as Utf8

def float(bits: U32) -> F32:
  match bits:
    case U32{data}:
      F32{data}

def bits(value: F32) -> U32:
  match value:
    case F32{data}:
      U32{data}

def guard(ok: Bool) -> Maybe<&1, Unit>:
  match ok:
    case True{}:
      Some{Unit{}}
    case False{}:
      None{}

def scalar(+code: U32) -> Bool:
  Bool.and(U32.is_le(code, 1114111), Bool.or(U32.is_lt(code, 55296), U32.is_gt(code, 57343)))

def char(+code: U32) -> Maybe<&1, Char>:
  do Maybe<&1, Char>:
    valid : Unit <- guard(scalar(code))
    return Chr{code}

def char_code(value: Char) -> Maybe<&1, U32>:
  match value:
    case Chr{+code}:
      do Maybe<&1, U32>:
        valid : Unit <- guard(scalar(code))
        return code

def take_text.decoded(got: Maybe<&2, String>, rest: List<&2, U32>) -> Maybe<&2, Bytes.SplitText>:
  match got:
    case None{}:
      None{}
    case Some{value}:
      Some{Bytes.SplitText{value, rest}}

def take_text.got(+max: U32, got: Maybe<&2, Bytes.SplitBytes>) -> Maybe<&2, Bytes.SplitText>:
  match got:
    case None{}:
      None{}
    case Some{Bytes.SplitBytes{raw, rest}}:
      take_text.decoded(Utf8.decode_text.go(Nat.add(Nat.mul(U32.to_nat(max), 2n), 1n), Utf8.DecodeStart{raw, SNil{}}), rest)

def take_text(+max: U32, bytes: List<&2, U32>) -> Maybe<&2, Bytes.SplitText>:
  take_text.got(max, Bytes.take_len_bytes(max, bytes))

def nat(+value: Nat) -> Maybe<&1, List<&2, U32>>:
  do Maybe<&1, List<&2, U32>>:
    u : Unit <- guard(Nat.is_le(value, Nat.add(Nat.mul(65535n, Nat.add(U32.to_nat(4294967295), 1n)), U32.to_nat(4294967295))))
    return Bytes.encode_nat(value)

def text.go(fuel: Nat, value: String, +budget: Nat, acc: List<&2, U32>, +count: U32) -> Maybe<&1, List<&2, U32>>:
  match fuel:
    case 0n:
      None{}
    case 1n+p:
      match value:
        case SNil{}:
          Some{count <> acc}
        case SCon{Chr{+code}, tail}:
          do Maybe<&1, List<&2, U32>>:
            valid : Unit <- guard(scalar(code))
            +bytes : List<&2, U32> = Utf8.utf8_encode_char(Chr{code})
            +size : Nat = List.length(&2, U32, bytes)
            fits : Unit <- guard(Nat.is_le(size, budget))
            text.go(p, tail, Nat.sub(budget, size), List.append(&2, U32, acc, bytes), (count + U32.from_nat(size) : U32))

def text(max: U32, value: String) -> Maybe<&1, List<&2, U32>>:
  text.go(249n, value, U32.to_nat(max), [], 0)

def envelope(encoded: Maybe<&1, List<&2, U32>>) -> List<&2, U32>:
  match encoded:
    case None{}:
      [255]
    case Some{bytes}:
      0 <> bytes
