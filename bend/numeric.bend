import Base
import ./bytes.bend as Bytes

type State is Type:
  Numeric{nat: Nat, total: U32, count: U32, f32_bits: U32}

type Command is Data:
  Accumulate{amount: Nat}
  Add{amount: U32}
  Read{}
  Reset{}
  Parse{text: String}
  Show{}
  F32Add{left: U32, right: U32}
  Compare{left: Nat, right: Nat}
  Bits{op: U32, left: U32, right: U32}

type Snapshot is Data:
  Snapshot{nat: Nat, total: U32, count: U32, f32_bits: U32}

def initial() -> State:
  Numeric{0n, 0, 0, 0}

def nat_max() -> Nat:
  Nat.add(Nat.mul(U32.to_nat(65535), Nat.add(U32.to_nat(4294967295), 1n)), U32.to_nat(4294967295))

def snapshot_of(+nat: Nat, +total: U32, +count: U32, +f32_bits: U32) -> Snapshot:
  Snapshot{nat, total, count, f32_bits}

def encode_snapshot(tag: U32, snap: Snapshot) -> List<&2, U32>:
  match snap:
    case Snapshot{nat, total, count, f32_bits}:
      tag <> List.append(&2, U32, Bytes.encode_nat(nat), List.append(&2, U32, Bytes.encode_u32(total), List.append(&2, U32, Bytes.encode_u32(count), Bytes.encode_u32(f32_bits))))

def encode_value(state: State) -> State & List<&2, U32>:
  match state:
    case Numeric{+nat, +total, +count, +f32_bits}:
      (Numeric{nat, total, count, f32_bits}, encode_snapshot(0, snapshot_of(nat, total, count, f32_bits)))

def encode_overflow(state: State) -> State & List<&2, U32>:
  match state:
    case Numeric{+nat, +total, +count, +f32_bits}:
      (Numeric{nat, total, count, f32_bits}, encode_snapshot(1, snapshot_of(nat, total, count, f32_bits)))

def accumulate_ok(ok: Bool, +nat: Nat, +total: U32, +count: U32, +f32_bits: U32, amount: Nat) -> State & List<&2, U32>:
  match ok:
    case False{}:
      encode_overflow(Numeric{nat, total, count, f32_bits})
    case True{}:
      encode_value(Numeric{Nat.add(nat, amount), total, count, f32_bits})

def add_ok(ok: Bool, +nat: Nat, +total: U32, +count: U32, +f32_bits: U32, amount: U32) -> State & List<&2, U32>:
  match ok:
    case False{}:
      encode_overflow(Numeric{nat, total, count, f32_bits})
    case True{}:
      encode_value(Numeric{nat, (total + amount : U32), (count + 1 : U32), f32_bits})

def parsed(got: Maybe<&2, Nat>, state: State) -> State & List<&2, U32>:
  match got:
    case None{}:
      (state, [4])
    case Some{n}:
      match state:
        case Numeric{old, total, count, f32_bits}:
          encode_value(Numeric{n, total, count, f32_bits})

def cmp_tag(c: Cmp) -> U32:
  match c:
    case LT{}:
      0
    case EQ{}:
      1
    case GT{}:
      2

def bit_op(+op: U32, +left: U32, +right: U32) -> U32:
  Bool.pick(U32, U32.is_eq(op, 0), (left .&. right : U32), Bool.pick(U32, U32.is_eq(op, 1), (left .|. right : U32), (left .^. right : U32)))

def f32_from_bits(bits: U32) -> F32:
  match bits:
    case U32{data}:
      F32{data}

def step(state: State, command: Command) -> State & List<&2, U32>:
  match state command:
    case Numeric{+nat, +total, +count, +f32_bits} Accumulate{+amount}:
      accumulate_ok(Nat.is_le(amount, Nat.sub(nat_max(), nat)), nat, total, count, f32_bits, amount)
    case Numeric{+nat, +total, +count, +f32_bits} Add{+amount}:
      add_ok(Bool.and(U32.is_le(amount, (4294967295 - total : U32)), U32.is_ne(count, 4294967295)), nat, total, count, f32_bits, amount)
    case Numeric{+nat, +total, +count, +f32_bits} Read{}:
      encode_value(Numeric{nat, total, count, f32_bits})
    case Numeric{nat, total, count, f32_bits} Reset{}:
      encode_value(initial())
    case Numeric{nat, total, count, f32_bits} Parse{text}:
      parsed(Nat.read(text), Numeric{nat, total, count, f32_bits})
    case Numeric{+nat, +total, +count, +f32_bits} Show{}:
      (Numeric{nat, total, count, f32_bits}, 5 <> Bytes.encode_text(Nat.show(nat)))
    case Numeric{nat, total, count, bits} F32Add{left, right}:
      +sum = F32.bits(F32.add(f32_from_bits(left), f32_from_bits(right)))
      encode_value(Numeric{nat, total, count, sum})
    case Numeric{+nat, +total, +count, +f32_bits} Compare{left, right}:
      (Numeric{nat, total, count, f32_bits}, [6, cmp_tag(Nat.cmp(left, right))])
    case Numeric{+nat, +total, +count, +f32_bits} Bits{op, left, right}:
      (Numeric{nat, total, count, f32_bits}, 7 <> Bytes.encode_u32(bit_op(op, left, right)))

def finish_acc(ok: Bool, n: Nat) -> Maybe<&2, Command>:
  match ok:
    case True{}:
      Some{Accumulate{n}}
    case False{}:
      None{}

def take_acc(got: Maybe<&2, Bytes.SplitNat>) -> Maybe<&2, Command>:
  match got:
    case None{}:
      None{}
    case Some{Bytes.SplitNat{n, more}}:
      finish_acc(Bytes.finished(more), n)

def finish_parse(ok: Bool, text: String) -> Maybe<&2, Command>:
  match ok:
    case True{}:
      Some{Parse{text}}
    case False{}:
      None{}

def take_parse(got: Maybe<&2, Bytes.SplitText>) -> Maybe<&2, Command>:
  match got:
    case None{}:
      None{}
    case Some{Bytes.SplitText{text, more}}:
      finish_parse(Bytes.finished(more), text)

def finish_f32(ok: Bool, left: U32, right: U32) -> Maybe<&2, Command>:
  match ok:
    case True{}:
      Some{F32Add{left, right}}
    case False{}:
      None{}

def take_f32_right(left: U32, got: Maybe<&2, Bytes.SplitU32>) -> Maybe<&2, Command>:
  match got:
    case None{}:
      None{}
    case Some{Bytes.SplitU32{right, more}}:
      finish_f32(Bytes.finished(more), left, right)

def take_f32(got: Maybe<&2, Bytes.SplitU32>) -> Maybe<&2, Command>:
  match got:
    case None{}:
      None{}
    case Some{Bytes.SplitU32{left, mid}}:
      take_f32_right(left, Bytes.take_u32(mid))

def finish_cmp(ok: Bool, left: Nat, right: Nat) -> Maybe<&2, Command>:
  match ok:
    case True{}:
      Some{Compare{left, right}}
    case False{}:
      None{}

def take_cmp_right(left: Nat, got: Maybe<&2, Bytes.SplitNat>) -> Maybe<&2, Command>:
  match got:
    case None{}:
      None{}
    case Some{Bytes.SplitNat{right, more}}:
      finish_cmp(Bytes.finished(more), left, right)

def take_cmp(got: Maybe<&2, Bytes.SplitNat>) -> Maybe<&2, Command>:
  match got:
    case None{}:
      None{}
    case Some{Bytes.SplitNat{left, mid}}:
      take_cmp_right(left, Bytes.take_nat(mid))

def finish_bits(ok: Bool, op: U32, left: U32, right: U32) -> Maybe<&2, Command>:
  match ok:
    case True{}:
      Some{Bits{op, left, right}}
    case False{}:
      None{}

def take_bits_right(op: U32, left: U32, got: Maybe<&2, Bytes.SplitU32>) -> Maybe<&2, Command>:
  match got:
    case None{}:
      None{}
    case Some{Bytes.SplitU32{right, more}}:
      finish_bits(Bytes.finished(more), op, left, right)

def take_bits_left(op: U32, got: Maybe<&2, Bytes.SplitU32>) -> Maybe<&2, Command>:
  match got:
    case None{}:
      None{}
    case Some{Bytes.SplitU32{left, mid}}:
      take_bits_right(op, left, Bytes.take_u32(mid))

def take_command(payload: List<&2, U32>) -> Maybe<&2, Command>:
  match payload:
    case 0 <> rest:
      take_acc(Bytes.take_nat(rest))
    case 1 <> a <> b <> c <> d <> Nil{}:
      Some{Add{(((a << 24n : U32) .|. (b << 16n : U32) : U32) .|. ((c << 8n : U32) .|. d : U32) : U32)}}
    case [2]:
      Some{Read{}}
    case [3]:
      Some{Reset{}}
    case 4 <> rest:
      take_parse(Bytes.take_text(96, rest))
    case [5]:
      Some{Show{}}
    case 6 <> rest:
      take_f32(Bytes.take_u32(rest))
    case 7 <> rest:
      take_cmp(Bytes.take_nat(rest))
    case 8 <> op <> rest:
      take_bits_left(op, Bytes.take_u32(rest))
    case other:
      None{}
