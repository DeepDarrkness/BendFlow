import Base
import ./utf8.bend as Utf8

type SplitU32 is Data:
  SplitU32{value: U32, rest: List<&2, U32>}

type SplitNat is Data:
  SplitNat{value: Nat, rest: List<&2, U32>}

type SplitBytes is Data:
  SplitBytes{value: List<&2, U32>, rest: List<&2, U32>}

type SplitText is Data:
  SplitText{value: String, rest: List<&2, U32>}

type SplitU32s is Data:
  SplitU32s{value: List<&2, U32>, rest: List<&2, U32>}

type U32sJob is Data:
  U32sNeed{n: Nat, bytes: List<&2, U32>, acc: List<&2, U32>}
  U32sGot{n: Nat, got: Maybe<&2, SplitU32>, acc: List<&2, U32>}

def take_u8(bytes: List<&2, U32>) -> Maybe<&2, SplitU32>:
  match bytes:
    case Nil{}:
      None{}
    case h <> t:
      Some{SplitU32{h, t}}

def take_u16(bytes: List<&2, U32>) -> Maybe<&2, SplitU32>:
  match bytes:
    case a <> b <> rest:
      Some{SplitU32{((a << 8n : U32) .|. b : U32), rest}}
    case other:
      None{}

def take_u32(bytes: List<&2, U32>) -> Maybe<&2, SplitU32>:
  match bytes:
    case a <> b <> c <> d <> rest:
      Some{SplitU32{(((a << 24n : U32) .|. (b << 16n : U32) : U32) .|. ((c << 8n : U32) .|. d : U32) : U32), rest}}
    case other:
      None{}

def take_nat(bytes: List<&2, U32>) -> Maybe<&2, SplitNat>:
  match bytes:
    case a <> b <> c <> d <> e <> f <> rest:
      +high = ((a << 8n : U32) .|. b : U32)
      +low = (((c << 24n : U32) .|. (d << 16n : U32) : U32) .|. ((e << 8n : U32) .|. f : U32) : U32)
      Some{SplitNat{Nat.add(Nat.mul(U32.to_nat(high), Nat.add(U32.to_nat(4294967295), 1n)), U32.to_nat(low)), rest}}
    case other:
      None{}

def take_exact.go(n: Nat, bytes: List<&2, U32>, acc: List<&2, U32>) -> Maybe<&2, SplitBytes>:
  match n:
    case 0n:
      Some{SplitBytes{List.reverse(&2, U32, acc), bytes}}
    case 1n+p:
      match bytes:
        case Nil{}:
          None{}
        case h <> t:
          take_exact.go(p, t, h <> acc)

def take_exact(n: U32, bytes: List<&2, U32>) -> Maybe<&2, SplitBytes>:
  take_exact.go(U32.to_nat(n), bytes, [])

def bounded_bytes(ok: Bool, n: U32, rest: List<&2, U32>) -> Maybe<&2, SplitBytes>:
  match ok:
    case False{}:
      None{}
    case True{}:
      take_exact(n, rest)

def take_len_got(max: U32, got: Maybe<&2, SplitU32>) -> Maybe<&2, SplitBytes>:
  match got:
    case None{}:
      None{}
    case Some{SplitU32{+n, rest}}:
      bounded_bytes(U32.is_le(n, max), n, rest)

def take_len_bytes(max: U32, bytes: List<&2, U32>) -> Maybe<&2, SplitBytes>:
  take_len_got(max, take_u8(bytes))

def decode_text(bytes: List<&2, U32>) -> Maybe<&2, String>:
  Utf8.decode_text(bytes)

def take_text.decoded(got: Maybe<&2, String>, rest: List<&2, U32>) -> Maybe<&2, SplitText>:
  match got:
    case None{}:
      None{}
    case Some{text}:
      Some{SplitText{text, rest}}

def take_text.got(got: Maybe<&2, SplitBytes>) -> Maybe<&2, SplitText>:
  match got:
    case None{}:
      None{}
    case Some{SplitBytes{raw, rest}}:
      take_text.decoded(decode_text(raw), rest)

def take_text(max: U32, bytes: List<&2, U32>) -> Maybe<&2, SplitText>:
  take_text.got(take_len_bytes(max, bytes))

def take_u32s.go(fuel: Nat, job: U32sJob) -> Maybe<&2, SplitU32s>:
  match fuel:
    case 0n:
      None{}
    case 1n+p:
      match job:
        case U32sNeed{n, bytes, acc}:
          match n:
            case 0n:
              Some{SplitU32s{List.reverse(&2, U32, acc), bytes}}
            case 1n+m:
              take_u32s.go(p, U32sGot{m, take_u32(bytes), acc})
        case U32sGot{n, got, acc}:
          match got:
            case None{}:
              None{}
            case Some{SplitU32{v, rest}}:
              take_u32s.go(p, U32sNeed{n, rest, v <> acc})

def take_u32s.bounded(ok: Bool, n: U32, rest: List<&2, U32>) -> Maybe<&2, SplitU32s>:
  match ok:
    case False{}:
      None{}
    case True{}:
      take_u32s.go(80n, U32sNeed{U32.to_nat(n), rest, []})

def take_u32s.prefix(max: U32, got: Maybe<&2, SplitU32>) -> Maybe<&2, SplitU32s>:
  match got:
    case None{}:
      None{}
    case Some{SplitU32{+n, rest}}:
      take_u32s.bounded(U32.is_le(n, max), n, rest)

def take_u32s(max: U32, bytes: List<&2, U32>) -> Maybe<&2, SplitU32s>:
  take_u32s.prefix(max, take_u8(bytes))

def encode_u8(n: U32) -> List<&2, U32>:
  [n]

def encode_u16(+n: U32) -> List<&2, U32>:
  [(n >> 8n : U32), (n .&. 255 : U32)]

def encode_u32(+n: U32) -> List<&2, U32>:
  [(n >> 24n : U32), ((n >> 16n : U32) .&. 255 : U32), ((n >> 8n : U32) .&. 255 : U32), (n .&. 255 : U32)]

def encode_nat.go(fuel: Nat, +n: Nat, acc: List<&2, U32>) -> List<&2, U32>:
  match fuel:
    case 0n:
      acc
    case 1n+p:
      encode_nat.go(p, Nat.div(n, 256n), U32.from_nat(Nat.mod(n, 256n)) <> acc)

def encode_nat(n: Nat) -> List<&2, U32>:
  encode_nat.go(6n, n, [])

def encode_len_bytes(+xs: List<&2, U32>) -> List<&2, U32>:
  U32.from_nat(List.length(&2, U32, xs)) <> xs


def encode_u32s.go(xs: List<&2, U32>, acc: List<&2, U32>) -> List<&2, U32>:
  match xs:
    case Nil{}:
      acc
    case h <> t:
      encode_u32s.go(t, List.append(&2, U32, acc, encode_u32(h)))

def encode_u32s(+xs: List<&2, U32>) -> List<&2, U32>:
  U32.from_nat(List.length(&2, U32, xs)) <> encode_u32s.go(xs, [])

def encode_text.go(s: String, acc: List<&2, U32>) -> List<&2, U32>:
  Utf8.encode_text.go(s, acc)

def encode_text(s: String) -> List<&2, U32>:
  encode_len_bytes(Utf8.encode_text(s))

def encode_error_bytes(code: U32, message: List<&2, U32>, fits: Bool) -> List<&2, U32>:
  match fits:
    case True{}:
      2 <> List.append(&2, U32, encode_u32(code), encode_len_bytes(message))
    case False{}:
      2 <> List.append(&2, U32, encode_u32(code), encode_text("native error message exceeds bound"))

def encode_error(error: U32 & String) -> List<&2, U32>:
  (code, message) = error
  +bytes = encode_text.go(message, [])
  encode_error_bytes(code, bytes, Nat.is_le(List.length(&2, U32, bytes), 96n))

def text_reply_bytes(tag: U32, bytes: List<&2, U32>, fits: Bool) -> List<&2, U32>:
  match fits:
    case True{}:
      tag <> encode_len_bytes(bytes)
    case False{}:
      encode_error((75, "reply exceeds text bound"))

def text_reply(tag: U32, text: String) -> List<&2, U32>:
  +bytes = encode_text.go(text, [])
  text_reply_bytes(tag, bytes, Nat.is_le(List.length(&2, U32, bytes), 96n))

def finished(bytes: List<&2, U32>) -> Bool:
  match bytes:
    case Nil{}:
      True{}
    case other:
      False{}

def id_key(id: U32) -> String:
  U32.show(id)

def bool_u8(value: Bool) -> U32:
  match value:
    case False{}:
      0
    case True{}:
      1

def u8_true(ok: Bool) -> Maybe<&2, Bool>:
  match ok:
    case True{}:
      Some{True{}}
    case False{}:
      None{}

def u8_false(zero: Bool, n: U32) -> Maybe<&2, Bool>:
  match zero:
    case True{}:
      Some{False{}}
    case False{}:
      u8_true(U32.is_eq(n, 1))

def u8_bool(+n: U32) -> Maybe<&2, Bool>:
  u8_false(U32.is_eq(n, 0), n)
