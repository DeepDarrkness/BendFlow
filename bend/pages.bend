import Base
import ./bytes.bend as Bytes

type Snapshot is Data:
  Snapshot{next: U32, token: U32, data: List<&2, U32>}

type Request is Data:
  Page{token: U32, offset: U32, max: U32}
  Release{token: U32}

def initial() -> Snapshot:
  Snapshot{1, 0, []}

def length(xs: List<&2, U32>) -> U32:
  U32.from_nat(List.length(&2, U32, xs))

def descriptor(+token: U32, data: List<&2, U32>) -> List<&2, U32>:
  6 <> List.append(&2, U32, Bytes.encode_u32(token), Bytes.encode_u32(length(data)))

def captured(ok: Bool, +next: U32, old: U32, previous: List<&2, U32>, +data: List<&2, U32>) -> Snapshot & List<&2, U32>:
  match ok:
    case False{}:
      (Snapshot{next, old, previous}, [11])
    case True{}:
      (Snapshot{(next + 1 : U32), next, data}, descriptor(next, data))

def capture(snapshot: Snapshot, data: List<&2, U32>) -> Snapshot & List<&2, U32>:
  match snapshot:
    case Snapshot{+next, old, previous}:
      captured(U32.is_ne(next, 0), next, old, previous, data)

def drop(n: Nat, xs: List<&2, U32>) -> List<&2, U32>:
  match n:
    case 0n:
      xs
    case 1n+p:
      match xs:
        case Nil{}:
          []
        case h <> t:
          drop(p, t)

def take(n: Nat, xs: List<&2, U32>) -> List<&2, U32>:
  match n:
    case 0n:
      []
    case 1n+p:
      match xs:
        case Nil{}:
          []
        case h <> t:
          h <> take(p, t)

def flag(done: Bool) -> U32:
  match done:
    case False{}:
      0
    case True{}:
      1

def envelope(+token: U32, +offset: U32, +total: U32, +count: U32, encoded: List<&2, U32>) -> List<&2, U32>:
  List.concat(&2, U32, [7 <> Bytes.encode_u32(token), Bytes.encode_u32(offset), Bytes.encode_u32(total), Bytes.encode_u32(count), flag(U32.is_eq((offset + count : U32), total)) <> encoded])

def page_valid(~encode: List<&2, U32> -> List<&2, U32>, valid: Bool, +snapshot: Snapshot, +token: U32, +offset: U32, max: U32, +data: List<&2, U32>) -> Snapshot & List<&2, U32>:
  match valid:
    case False{}:
      (snapshot, [9])
    case True{}:
      +part = take(U32.to_nat(max), drop(U32.to_nat(offset), data))
      (snapshot, envelope(token, offset, length(data), length(part), encode(part)))

def page_found(~encode: List<&2, U32> -> List<&2, U32>, found: Bool, snapshot: Snapshot, token: U32, +offset: U32, max: U32, +data: List<&2, U32>) -> Snapshot & List<&2, U32>:
  match found:
    case False{}:
      (snapshot, [8])
    case True{}:
      page_valid(~encode, U32.is_le(offset, length(data)), snapshot, token, offset, max, data)

def page(~encode: List<&2, U32> -> List<&2, U32>, snapshot: Snapshot, +token: U32, offset: U32, max: U32) -> Snapshot & List<&2, U32>:
  match snapshot:
    case Snapshot{next, +old, +data}:
      page_found(~encode, U32.is_eq(old, token), Snapshot{next, old, data}, token, offset, max, data)

def release_found(found: Bool, next: U32, old: U32, data: List<&2, U32>) -> Snapshot & List<&2, U32>:
  match found:
    case False{}:
      (Snapshot{next, old, data}, [0])
    case True{}:
      (Snapshot{next, 0, []}, [0])

def release(snapshot: Snapshot, token: U32) -> Snapshot & List<&2, U32>:
  match snapshot:
    case Snapshot{next, +old, data}:
      release_found(U32.is_eq(old, token), next, old, data)

def valid_unit(ok: Bool) -> Maybe<&2, Unit>:
  match ok:
    case True{}:
      Some{Unit{}}
    case False{}:
      None{}

def parse_page.end(cap: U32, +token: U32, offset: U32, got: Maybe<&2, Bytes.SplitU32>) -> Maybe<&2, Request>:
  match got:
    case None{}:
      None{}
    case Some{Bytes.SplitU32{+max, end}}:
      do Maybe<&2, Request>:
        valid : Unit <- valid_unit(Bool.and(Bytes.finished(end), Bool.and(U32.is_ne(token, 0), Bool.and(U32.is_gt(max, 0), U32.is_le(max, cap)))))
        return Page{token, offset, max}

def parse_page.offset(cap: U32, token: U32, got: Maybe<&2, Bytes.SplitU32>) -> Maybe<&2, Request>:
  match got:
    case None{}:
      None{}
    case Some{Bytes.SplitU32{offset, more}}:
      parse_page.end(cap, token, offset, Bytes.take_u32(more))

def parse_page.token(cap: U32, got: Maybe<&2, Bytes.SplitU32>) -> Maybe<&2, Request>:
  match got:
    case None{}:
      None{}
    case Some{Bytes.SplitU32{token, rest}}:
      parse_page.offset(cap, token, Bytes.take_u32(rest))

def parse_page(cap: U32, raw: List<&2, U32>) -> Maybe<&2, Request>:
  parse_page.token(cap, Bytes.take_u32(raw))

def parse_release.got(got: Maybe<&2, Bytes.SplitU32>) -> Maybe<&2, Request>:
  match got:
    case None{}:
      None{}
    case Some{Bytes.SplitU32{+token, end}}:
      do Maybe<&2, Request>:
        valid : Unit <- valid_unit(Bool.and(Bytes.finished(end), U32.is_ne(token, 0)))
        return Release{token}

def parse_release(raw: List<&2, U32>) -> Maybe<&2, Request>:
  parse_release.got(Bytes.take_u32(raw))
