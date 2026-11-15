import Base

type SplitChar is Data:
  SplitChar{value: Char, rest: List<&2, U32>}

type DecodeJob is Data:
  DecodeStart{bytes: List<&2, U32>, acc: String}
  DecodeCont{got: Maybe<&2, SplitChar>, acc: String}

def utf8_cont(+b: U32) -> Bool:
  Bool.and(U32.is_ge(b, 128), U32.is_le(b, 191))

def scalar_char(valid: Bool, code: U32, more: List<&2, U32>) -> Maybe<&2, SplitChar>:
  match valid:
    case False{}:
      None{}
    case True{}:
      Some{SplitChar{Chr{code}, more}}

def four_byte_got(ok: Bool, +b: U32, +c: U32, +d: U32, +e: U32, more: List<&2, U32>) -> Maybe<&2, SplitChar>:
  match ok:
    case False{}:
      None{}
    case True{}:
      +code = (((((b .&. 7 : U32) << 18n : U32) .|. ((c .&. 63 : U32) << 12n : U32) : U32) .|. ((d .&. 63 : U32) << 6n : U32) : U32) .|. (e .&. 63 : U32) : U32)
      scalar_char(Bool.and(U32.is_ge(code, 65536), U32.is_le(code, 1114111)), code, more)

def four_byte_char(ok: Bool, b: U32, rest: List<&2, U32>) -> Maybe<&2, SplitChar>:
  match ok:
    case False{}:
      None{}
    case True{}:
      match rest:
        case +c <> +d <> +e <> more:
          four_byte_got(Bool.and(Bool.and(utf8_cont(c), utf8_cont(d)), utf8_cont(e)), b, c, d, e, more)
        case other:
          None{}

def three_byte_got(ok: Bool, +b: U32, +c: U32, +d: U32, more: List<&2, U32>) -> Maybe<&2, SplitChar>:
  match ok:
    case False{}:
      None{}
    case True{}:
      +code = ((((b .&. 15 : U32) << 12n : U32) .|. ((c .&. 63 : U32) << 6n : U32) : U32) .|. (d .&. 63 : U32) : U32)
      scalar_char(Bool.and(U32.is_ge(code, 2048), Bool.or(U32.is_lt(code, 55296), U32.is_gt(code, 57343))), code, more)

def three_byte_char(ok: Bool, +b: U32, rest: List<&2, U32>) -> Maybe<&2, SplitChar>:
  match ok:
    case True{}:
      match rest:
        case +c <> +d <> more:
          three_byte_got(Bool.and(utf8_cont(c), utf8_cont(d)), b, c, d, more)
        case other:
          None{}
    case False{}:
      four_byte_char(Bool.and(U32.is_ge(b, 240), U32.is_le(b, 244)), b, rest)

def two_byte_got(ok: Bool, +b: U32, +c: U32, more: List<&2, U32>) -> Maybe<&2, SplitChar>:
  match ok:
    case False{}:
      None{}
    case True{}:
      +code = (((b .&. 31 : U32) << 6n : U32) .|. (c .&. 63 : U32) : U32)
      Some{SplitChar{Chr{code}, more}}

def two_byte_char(ok: Bool, +b: U32, rest: List<&2, U32>) -> Maybe<&2, SplitChar>:
  match ok:
    case True{}:
      match rest:
        case +c <> more:
          two_byte_got(utf8_cont(c), b, c, more)
        case other:
          None{}
    case False{}:
      three_byte_char(Bool.and(U32.is_ge(b, 224), U32.is_le(b, 239)), b, rest)

def ascii_char(ok: Bool, +b: U32, rest: List<&2, U32>) -> Maybe<&2, SplitChar>:
  match ok:
    case True{}:
      Some{SplitChar{Chr{b}, rest}}
    case False{}:
      two_byte_char(Bool.and(U32.is_ge(b, 194), U32.is_le(b, 223)), b, rest)

def decode_char(bytes: List<&2, U32>) -> Maybe<&2, SplitChar>:
  match bytes:
    case Nil{}:
      None{}
    case +b <> rest:
      ascii_char(U32.is_le(b, 127), b, rest)

def decode_text.go(fuel: Nat, job: DecodeJob) -> Maybe<&2, String>:
  match fuel:
    case 0n:
      None{}
    case 1n+p:
      match job:
        case DecodeStart{bytes, acc}:
          match bytes:
            case Nil{}:
              Some{String.reverse(acc)}
            case other:
              decode_text.go(p, DecodeCont{decode_char(other), acc})
        case DecodeCont{got, acc}:
          match got:
            case None{}:
              None{}
            case Some{SplitChar{c, rest}}:
              decode_text.go(p, DecodeStart{rest, SCon{c, acc}})

def decode_text(bytes: List<&2, U32>) -> Maybe<&2, String>:
  decode_text.go(200n, DecodeStart{bytes, SNil{}})

def encode_four(+code: U32) -> List<&2, U32>:
  [(240 .|. (code >> 18n : U32) : U32), (128 .|. ((code >> 12n : U32) .&. 63 : U32) : U32), (128 .|. ((code >> 6n : U32) .&. 63 : U32) : U32), (128 .|. (code .&. 63 : U32) : U32)]

def encode_three(ok: Bool, +code: U32) -> List<&2, U32>:
  match ok:
    case True{}:
      [(224 .|. (code >> 12n : U32) : U32), (128 .|. ((code >> 6n : U32) .&. 63 : U32) : U32), (128 .|. (code .&. 63 : U32) : U32)]
    case False{}:
      encode_four(code)

def encode_two(ok: Bool, +code: U32) -> List<&2, U32>:
  match ok:
    case True{}:
      [(192 .|. (code >> 6n : U32) : U32), (128 .|. (code .&. 63 : U32) : U32)]
    case False{}:
      encode_three(U32.is_le(code, 65535), code)

def encode_ascii(ok: Bool, +code: U32) -> List<&2, U32>:
  match ok:
    case True{}:
      [code]
    case False{}:
      encode_two(U32.is_le(code, 2047), code)

def utf8_encode_char(c: Char) -> List<&2, U32>:
  match c:
    case Chr{+code}:
      encode_ascii(U32.is_le(code, 127), code)

def encode_text.go(s: String, acc: List<&2, U32>) -> List<&2, U32>:
  match s:
    case SNil{}:
      acc
    case SCon{c, t}:
      encode_text.go(t, List.append(&2, U32, acc, utf8_encode_char(c)))

def encode_text(s: String) -> List<&2, U32>:
  encode_text.go(s, [])
