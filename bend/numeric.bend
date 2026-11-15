import Base
import ./bytes.bend as Bytes
import ./numeric-core.bend as Core

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
  CalculateNat{op: U32, left: Nat, right: Nat}
  CalculateWord{domain: U32, op: U32, left: U32, right: U32}
  ConvertNat{op: U32, value: Nat}
  ConvertWord{op: U32, value: U32}
  CompareNat{op: U32, left: Nat, right: Nat}
  CompareWord{domain: U32, op: U32, left: U32, right: U32}
  Boolean{op: U32, left: Bool, right: Bool}

type Snapshot is Data:
  Snapshot{nat: Nat, total: U32, count: U32, f32_bits: U32}

def numeric_state(s: Core.State) -> State:
  match s:
    case Core.Numeric{nat, total, count, bits}:
      Numeric{nat, U32.from_nat(total), U32.from_nat(count), bits}

def initial() -> State:
  numeric_state(Core.initial())

def nat_max() -> Nat:
  Nat.add(Nat.mul(U32.to_nat(65535), Nat.add(U32.to_nat(4294967295), 1n)), U32.to_nat(4294967295))

def nat_decimal_prefix_max() -> Nat:
  Nat.add(Nat.mul(U32.to_nat(6553), Nat.add(U32.to_nat(4294967295), 1n)), U32.to_nat(2576980377))

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

def encode_added(outcome: Core.Outcome) -> State & List<&2, U32>:
  match outcome:
    case Core.Rejected{s}: encode_overflow(numeric_state(s))
    case Core.Accepted{s}: encode_value(numeric_state(s))

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
  match op:
    case 0: U32.and(left, right)
    case 1: U32.or(left, right)
    case 2: U32.xor(left, right)
    case 3: U32.not(left)
    case 4: U32.shln(left, U32.to_nat(right))
    case other: U32.shrn(left, U32.to_nat(right))

def f32_from_bits(bits: U32) -> F32:
  match bits:
    case U32{data}:
      F32{data}

def nat_reply(n: Nat) -> List<&2, U32>:
  8 <> Bytes.encode_nat(n)

def word_reply(n: U32) -> List<&2, U32>:
  7 <> Bytes.encode_u32(n)

def nat_calc_ready(ok: Bool, op: U32, +a: Nat, +b: Nat) -> List<&2, U32>:
  match ok:
    case False{}: [10, 0]
    case True{}:
      match op:
        case 0: nat_reply(Nat.add(a, b))
        case 1: nat_reply(Nat.sub(a, b))
        case 2: nat_reply(Nat.mul(a, b))
        case 3: nat_reply(Nat.div(a, b))
        case other: nat_reply(Nat.mod(a, b))

def nat_mul_bound(zero: Bool, +a: Nat, +b: Nat) -> List<&2, U32>:
  match zero:
    case True{}: nat_reply(0n)
    case False{}: nat_calc_ready(Nat.is_le(a, Nat.div(nat_max(), b)), 2, a, b)

def nat_div_ready(zero: Bool, op: U32, a: Nat, b: Nat) -> List<&2, U32>:
  match zero:
    case True{}: [10, 1]
    case False{}: nat_calc_ready(True{}, op, a, b)

def nat_calc(op: U32, +a: Nat, +b: Nat) -> List<&2, U32>:
  match op:
    case 0: nat_calc_ready(Nat.is_le(b, Nat.sub(nat_max(), a)), 0, a, b)
    case 1: nat_reply(Nat.sub(a, b))
    case 2: nat_mul_bound(Nat.is_eq(b, 0n), a, b)
    case other: nat_div_ready(Nat.is_eq(b, 0n), other, a, b)

def u32_div_ready(zero: Bool, op: U32, a: U32, b: U32) -> List<&2, U32>:
  match zero:
    case True{}: [10, 1]
    case False{}:
      match op:
        case 3: word_reply(U32.div(a, b))
        case other: word_reply(U32.mod(a, b))

def u32_calc(op: U32, a: U32, +b: U32) -> List<&2, U32>:
  match op:
    case 0: word_reply(U32.add(a, b))
    case 1: word_reply(U32.sub(a, b))
    case 2: word_reply(U32.mul(a, b))
    case other: u32_div_ready(U32.is_eq(b, 0), other, a, b)

def f32_calc(op: U32, a: F32, b: F32) -> List<&2, U32>:
  match op:
    case 0: word_reply(F32.bits(F32.add(a, b)))
    case 1: word_reply(F32.bits(F32.sub(a, b)))
    case 2: word_reply(F32.bits(F32.mul(a, b)))
    case 3: word_reply(F32.bits(F32.div(a, b)))
    case other: word_reply(F32.bits(F32.mod(a, b)))

def word_calc(domain: U32, op: U32, a: U32, b: U32) -> List<&2, U32>:
  match domain:
    case 1: u32_calc(op, a, b)
    case other: f32_calc(op, f32_from_bits(a), f32_from_bits(b))

def nat_compare(op: U32, a: Nat, b: Nat) -> Bool:
  match op:
    case 0: Nat.is_eq(a, b)
    case 1: Nat.is_ne(a, b)
    case 2: Nat.is_lt(a, b)
    case 3: Nat.is_le(a, b)
    case 4: Nat.is_gt(a, b)
    case other: Nat.is_ge(a, b)

def u32_compare(op: U32, a: U32, b: U32) -> Bool:
  match op:
    case 0: U32.is_eq(a, b)
    case 1: U32.is_ne(a, b)
    case 2: U32.is_lt(a, b)
    case 3: U32.is_le(a, b)
    case 4: U32.is_gt(a, b)
    case other: U32.is_ge(a, b)

def f32_compare(op: U32, a: F32, b: F32) -> Bool:
  match op:
    case 0: F32.is_eq(a, b)
    case 1: F32.is_ne(a, b)
    case 2: F32.is_lt(a, b)
    case 3: F32.is_le(a, b)
    case 4: F32.is_gt(a, b)
    case other: F32.is_ge(a, b)

def word_compare(domain: U32, op: U32, a: U32, b: U32) -> Bool:
  match domain:
    case 1: u32_compare(op, a, b)
    case other: f32_compare(op, f32_from_bits(a), f32_from_bits(b))

def bool_op(op: U32, a: Bool, b: Bool) -> Bool:
  match op:
    case 0: Bool.and(a, b)
    case 1: Bool.or(a, b)
    case 2: Bool.xor(a, b)
    case other: Bool.not(a)

def convert_nat(op: U32, n: Nat) -> List<&2, U32>:
  match op:
    case 0: word_reply(U32.from_nat(n))
    case other: word_reply(F32.bits(F32.from_nat(n)))

def convert_float_ready(ok: Bool, op: U32, f: F32) -> List<&2, U32>:
  match ok:
    case False{}: [10, 2]
    case True{}:
      match op:
        case 4: word_reply(F32.to_u32(f))
        case other: nat_reply(F32.to_nat(f))

def convert_float(+op: U32, f: F32) -> List<&2, U32>:
  match f:
    case F32{+bits}:
      +limit = Bool.pick(F32, U32.is_eq(op, 4), 4294967296.0, 281474976710656.0)
      convert_float_ready(Bool.and(F32.is_ge(F32{bits}, 0.0), F32.is_lt(F32{bits}, limit)), op, F32{bits})

def convert_word(op: U32, n: U32) -> List<&2, U32>:
  match op:
    case 2: nat_reply(U32.to_nat(n))
    case 3: word_reply(F32.bits(U32.to_f32(n)))
    case other: convert_float(other, f32_from_bits(n))

type ParseJob is Data:
  Digits{text: String, acc: Nat}
  DigitCheck{ok: Bool, text: String, acc: Nat, digit: Nat}

def parse_digits(fuel: Nat, job: ParseJob) -> Maybe<&2, Nat>:
  match fuel:
    case 0n: None{}
    case 1n+p:
      match job:
        case Digits{text, +acc}:
          match text:
            case SNil{}: Some{acc}
            case SCon{Chr{+c}, rest}:
              +digit = U32.to_nat((c - 48 : U32))
              +valid = Bool.and(U32.is_ge(c, 48), U32.is_le(c, 57))
              +fits = Bool.or(Nat.is_lt(acc, nat_decimal_prefix_max()), Bool.and(Nat.is_eq(acc, nat_decimal_prefix_max()), Nat.is_le(digit, 5n)))
              parse_digits(p, DigitCheck{Bool.and(valid, fits), rest, acc, digit})
        case DigitCheck{ok, text, acc, digit}:
          match ok:
            case False{}: None{}
            case True{}: parse_digits(p, Digits{text, Nat.add(Nat.mul(acc, 10n), digit)})

def parse_nat(text: String) -> Maybe<&2, Nat>:
  match text:
    case SNil{}: None{}
    case SCon{c, rest}: parse_digits(194n, Digits{SCon{c, rest}, 0n})

def step(state: State, command: Command) -> State & List<&2, U32>:
  match state command:
    case Numeric{+nat, +total, +count, +f32_bits} Accumulate{+amount}:
      accumulate_ok(Nat.is_le(amount, Nat.sub(nat_max(), nat)), nat, total, count, f32_bits, amount)
    case Numeric{+nat, +total, +count, +f32_bits} Add{+amount}:
      encode_added(Core.add(Core.word_max(), Core.Numeric{nat, U32.to_nat(total), U32.to_nat(count), f32_bits}, U32.to_nat(amount)))
    case Numeric{+nat, +total, +count, +f32_bits} Read{}:
      encode_value(Numeric{nat, total, count, f32_bits})
    case Numeric{nat, total, count, f32_bits} Reset{}:
      encode_value(numeric_state(Core.reset(Core.Numeric{nat, U32.to_nat(total), U32.to_nat(count), f32_bits})))
    case Numeric{nat, total, count, f32_bits} Parse{text}:
      parsed(parse_nat(text), Numeric{nat, total, count, f32_bits})
    case Numeric{+nat, +total, +count, +f32_bits} Show{}:
      (Numeric{nat, total, count, f32_bits}, 5 <> Bytes.encode_text(Nat.show(nat)))
    case Numeric{nat, total, count, bits} F32Add{left, right}:
      +sum = F32.bits(F32.add(f32_from_bits(left), f32_from_bits(right)))
      encode_value(Numeric{nat, total, count, sum})
    case Numeric{+nat, +total, +count, +f32_bits} Compare{left, right}:
      (Numeric{nat, total, count, f32_bits}, [6, cmp_tag(Nat.cmp(left, right))])
    case Numeric{+nat, +total, +count, +f32_bits} Bits{op, left, right}:
      (Numeric{nat, total, count, f32_bits}, 7 <> Bytes.encode_u32(bit_op(op, left, right)))
    case s CalculateNat{op, a, b}: (s, nat_calc(op, a, b))
    case s CalculateWord{d, op, a, b}: (s, word_calc(d, op, a, b))
    case s ConvertNat{op, n}: (s, convert_nat(op, n))
    case s ConvertWord{op, n}: (s, convert_word(op, n))
    case s CompareNat{op, a, b}: (s, [9, Bytes.bool_u8(nat_compare(op, a, b))])
    case s CompareWord{d, op, a, b}: (s, [9, Bytes.bool_u8(word_compare(d, op, a, b))])
    case s Boolean{op, a, b}: (s, [9, Bytes.bool_u8(bool_op(op, a, b))])

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

def finish_bits.valid(ok: Bool, op: U32, left: U32, right: U32) -> Maybe<&2, Command>:
  match ok:
    case True{}: Some{Bits{op, left, right}}
    case False{}: None{}

def finish_bits(ok: Bool, +op: U32, left: U32, right: U32) -> Maybe<&2, Command>:
  match ok:
    case True{}:
      finish_bits.valid(U32.is_le(op, 5), op, left, right)
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

def pair_nat_finish(ok: Bool, tag: U32, op: U32, a: Nat, b: Nat) -> Maybe<&2, Command>:
  match ok:
    case False{}: None{}
    case True{}:
      match tag:
        case 9: Some{CalculateNat{op, a, b}}
        case other: Some{CompareNat{op, a, b}}

def pair_nat_right(tag: U32, op: U32, a: Nat, got: Maybe<&2, Bytes.SplitNat>) -> Maybe<&2, Command>:
  match got:
    case None{}: None{}
    case Some{Bytes.SplitNat{b, rest}}: pair_nat_finish(Bytes.finished(rest), tag, op, a, b)

def pair_nat(tag: U32, op: U32, got: Maybe<&2, Bytes.SplitNat>) -> Maybe<&2, Command>:
  match got:
    case None{}: None{}
    case Some{Bytes.SplitNat{a, rest}}: pair_nat_right(tag, op, a, Bytes.take_nat(rest))

def pair_word_finish(ok: Bool, tag: U32, d: U32, op: U32, a: U32, b: U32) -> Maybe<&2, Command>:
  match ok:
    case False{}: None{}
    case True{}:
      match tag:
        case 9: Some{CalculateWord{d, op, a, b}}
        case other: Some{CompareWord{d, op, a, b}}

def pair_word_right(tag: U32, d: U32, op: U32, a: U32, got: Maybe<&2, Bytes.SplitU32>) -> Maybe<&2, Command>:
  match got:
    case None{}: None{}
    case Some{Bytes.SplitU32{b, rest}}: pair_word_finish(Bytes.finished(rest), tag, d, op, a, b)

def pair_word(tag: U32, d: U32, op: U32, got: Maybe<&2, Bytes.SplitU32>) -> Maybe<&2, Command>:
  match got:
    case None{}: None{}
    case Some{Bytes.SplitU32{a, rest}}: pair_word_right(tag, d, op, a, Bytes.take_u32(rest))

def take_pair_valid(ok: Bool, tag: U32, d: U32, op: U32, rest: List<&2, U32>) -> Maybe<&2, Command>:
  match ok:
    case False{}: None{}
    case True{}:
      match d:
        case 0: pair_nat(tag, op, Bytes.take_nat(rest))
        case other: pair_word(tag, other, op, Bytes.take_u32(rest))

def take_pair(+tag: U32, +d: U32, +op: U32, rest: List<&2, U32>) -> Maybe<&2, Command>:
  +max = Bool.pick(U32, U32.is_eq(tag, 9), 4, 5)
  take_pair_valid(Bool.and(U32.is_le(d, 2), U32.is_le(op, max)), tag, d, op, rest)

def conversion_nat_finish(ok: Bool, op: U32, n: Nat) -> Maybe<&2, Command>:
  match ok:
    case False{}: None{}
    case True{}: Some{ConvertNat{op, n}}

def conversion_nat(op: U32, got: Maybe<&2, Bytes.SplitNat>) -> Maybe<&2, Command>:
  match got:
    case None{}: None{}
    case Some{Bytes.SplitNat{n, rest}}: conversion_nat_finish(Bytes.finished(rest), op, n)

def conversion_word_finish(ok: Bool, op: U32, n: U32) -> Maybe<&2, Command>:
  match ok:
    case False{}: None{}
    case True{}: Some{ConvertWord{op, n}}

def conversion_word(op: U32, got: Maybe<&2, Bytes.SplitU32>) -> Maybe<&2, Command>:
  match got:
    case None{}: None{}
    case Some{Bytes.SplitU32{n, rest}}: conversion_word_finish(Bytes.finished(rest), op, n)

def take_conversion_valid(ok: Bool, op: U32, rest: List<&2, U32>) -> Maybe<&2, Command>:
  match ok:
    case False{}: None{}
    case True{}:
      match op:
        case 0: conversion_nat(0, Bytes.take_nat(rest))
        case 1: conversion_nat(1, Bytes.take_nat(rest))
        case other: conversion_word(other, Bytes.take_u32(rest))

def take_bool_valid(ok: Bool, op: U32, a: U32, b: U32) -> Maybe<&2, Command>:
  match ok:
    case False{}: None{}
    case True{}: Some{Boolean{op, U32.is_eq(a, 1), U32.is_eq(b, 1)}}

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
    case 9 <> d <> op <> rest: take_pair(9, d, op, rest)
    case 10 <> +op <> rest: take_conversion_valid(U32.is_le(op, 5), op, rest)
    case 11 <> d <> op <> rest: take_pair(11, d, op, rest)
    case [12, +op, +a, +b]: take_bool_valid(Bool.and(U32.is_le(op, 3), Bool.and(U32.is_le(a, 1), U32.is_le(b, 1))), op, a, b)
    case other:
      None{}
