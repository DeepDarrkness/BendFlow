import Base
import ./bytes.bend as Bytes
import ./pages.bend as Pages

type Choice is Data:
  Number{value: U32}
  ChoiceText{text: String}

type Nested is Data:
  Nested{name: String, point: +Sigma<U32, _ => U32>, optional: Maybe<&2, U32>, choice: Choice, items: List<&2, U32>}

type State is Type:
  Features{set: Set(), closure: Maybe<&1, U32 -> U32>, nested: Maybe<&2, Nested>}

type Command is Data:
  PutNested{record: Nested}
  GetNested{}
  SetEdit{add: String, remove: String, has: String}
  Fold{}
  Transform{value: U32, text: String}
  StoreClosure{amount: U32}
  ConsumeClosure{value: U32}
  Sized{}
  MaybeAdd{left: String, right: String}
  ResultAdd{left: String, right: String}

def SizedList(n: Nat) -> Type:
  match n:
    case 0n:
      Unit
    case 1n+p:
      U32 & SizedList(p)

def first(-n: Nat, list: SizedList(1n+n)) -> U32:
  (head, tail) = list
  head

def initial() -> State:
  Features{Set.new(), None{}, None{}}

def identity(-A: Data, value: A) -> A:
  value

def twice(~f: U32 -> U32, value: U32) -> U32:
  f(f(value))

def inc(value: U32) -> U32:
  (value + 1 : U32)

def apply(f: U32 -> U32, value: U32) -> U32:
  f(value)

def adder(amount: U32) -> U32 -> U32:
  value => (value + amount : U32)

def encode_cell(value: U32) -> List<&2, U32>:
  4 <> Bytes.encode_u32(value)

def encode_nested.choice(name: String, point: +Sigma<U32, _ => U32>, optional: Maybe<&2, U32>, choice: Choice, items: List<&2, U32>) -> List<&2, U32>:
  (x, y) = point
  match optional choice:
    case None{} Number{value}:
      List.concat(&2, U32, [12 <> Bytes.encode_text(name), Bytes.encode_text(""), Bytes.encode_u32s(x <> y <> 0 <> 0 <> 0 <> value <> items)])
    case Some{value} Number{number}:
      List.concat(&2, U32, [12 <> Bytes.encode_text(name), Bytes.encode_text(""), Bytes.encode_u32s(x <> y <> 1 <> value <> 0 <> number <> items)])
    case None{} ChoiceText{text}:
      List.concat(&2, U32, [12 <> Bytes.encode_text(name), Bytes.encode_text(text), Bytes.encode_u32s(x <> y <> 0 <> 0 <> 1 <> 0 <> items)])
    case Some{value} ChoiceText{text}:
      List.concat(&2, U32, [12 <> Bytes.encode_text(name), Bytes.encode_text(text), Bytes.encode_u32s(x <> y <> 1 <> value <> 1 <> 0 <> items)])

def encode_nested(record: Nested) -> List<&2, U32>:
  match record:
    case Nested{name, point, optional, choice, items}:
      encode_nested.choice(name, point, optional, choice, items)

def maybe_add(left: String, right: String) -> Maybe<&2, U32>:
  do Maybe<&2, U32>:
    a : U32 <- U32.read(left)
    b : U32 <- U32.read(right)
    return (a + b : U32)

def parsed(error: U32, value: Maybe<&2, U32>) -> Result<&2, &2, U32, U32>:
  match value:
    case None{}:
      Fail{error}
    case Some{x}:
      Done{x}

def result_add(left: String, right: String) -> Result<&2, &2, U32, U32>:
  do Result<&2, &2, U32, U32>:
    a : U32 <- parsed(0, U32.read(left))
    b : U32 <- parsed(1, U32.read(right))
    return (a + b : U32)

def encode_maybe(value: Maybe<&2, U32>) -> List<&2, U32>:
  match value:
    case None{}:
      [15, 0]
    case Some{x}:
      15 <> 1 <> Bytes.encode_u32(x)

def encode_result(value: Result<&2, &2, U32, U32>) -> List<&2, U32>:
  match value:
    case Fail{error}:
      [17, error]
    case Done{x}:
      16 <> Bytes.encode_u32(x)

def set_result(closure: Maybe<&1, U32 -> U32>, nested: Maybe<&2, Nested>, got: Set() & Bool) -> State & List<&2, U32>:
  (set, has) = got
  +keys = Set.to_list(set)
  (Features{Set.from_list(keys), closure, nested}, List.append(&2, U32, 13 <> Bytes.encode_u32(U32.from_nat(List.length(&2, String, keys))), [Pages.flag(has)]))

def consume(set: Set(), nested: Maybe<&2, Nested>, value: U32, closure: Maybe<&1, U32 -> U32>) -> State & List<&2, U32>:
  match closure:
    case None{}:
      (Features{set, None{}, nested}, [2])
    case Some{f}:
      (Features{set, None{}, nested}, encode_cell(f(value)))

def get_nested(set: Set(), closure: Maybe<&1, U32 -> U32>, nested: Maybe<&2, Nested>) -> State & List<&2, U32>:
  match nested:
    case None{}:
      (Features{set, closure, None{}}, [2])
    case Some{+record}:
      (Features{set, closure, Some{record}}, encode_nested(record))

def pack_cons(head: U32, got: &n:Nat -> SizedList(n)) -> &n:Nat -> SizedList(n):
  (n, tail) = got
  (1n+n, (head, tail))

def pack(items: List<&2, U32>) -> &n:Nat -> SizedList(n):
  match items:
    case Nil{}:
      (0n, Unit{})
    case h <> t:
      pack_cons(h, pack(t))

def sized_head(head: U32, got: &n:Nat -> SizedList(n)) -> List<&2, U32>:
  (n, tail) = got
  encode_cell(first(n, (head, tail)))

def sized(items: List<&2, U32>) -> List<&2, U32>:
  match items:
    case Nil{}:
      [2]
    case h <> t:
      sized_head(h, pack(t))

def step(state: State, command: Command, items: List<&2, U32>) -> State & List<&2, U32>:
  match state command:
    case Features{set, closure, nested} PutNested{+record}:
      (Features{set, closure, Some{record}}, encode_nested(record))
    case Features{set, closure, nested} GetNested{}:
      get_nested(set, closure, nested)
    case Features{set, closure, nested} SetEdit{add, remove, has}:
      set_result(closure, nested, Set.has(Set.del(Set.add(set, add), remove), has))
    case Features{set, closure, nested} Fold{}:
      (Features{set, closure, nested}, encode_cell(List.foldl(~&2, ~U32, ~U32, ~(a => b => (a + b : U32)), items, 0)))
    case Features{set, closure, nested} Transform{+value, text}:
      (Features{set, closure, nested}, List.concat(&2, U32, [14 <> Bytes.encode_u32(twice(~inc, value)), Bytes.encode_u32(apply(adder(3), value)), Bytes.encode_u32(identity(U32, value)), Bytes.encode_text(identity(String, text))]))
    case Features{set, closure, nested} StoreClosure{amount}:
      (Features{set, Some{adder(amount)}, nested}, [0])
    case Features{set, closure, nested} ConsumeClosure{value}:
      consume(set, nested, value, closure)
    case Features{set, closure, nested} Sized{}:
      (Features{set, closure, nested}, sized(items))
    case Features{set, closure, nested} MaybeAdd{left, right}:
      (Features{set, closure, nested}, encode_maybe(maybe_add(left, right)))
    case Features{set, closure, nested} ResultAdd{left, right}:
      (Features{set, closure, nested}, encode_result(result_add(left, right)))

def nested_flags(ok: Bool, name: String, text: String, x: U32, y: U32, present: U32, optional: U32, choice: U32, number: U32, items: List<&2, U32>) -> Maybe<&2, Command>:
  match ok present choice:
    case True{} 0 0:
      Some{PutNested{Nested{name, (x, y), None{}, Number{number}, items}}}
    case True{} 1 0:
      Some{PutNested{Nested{name, (x, y), Some{optional}, Number{number}, items}}}
    case True{} 0 1:
      Some{PutNested{Nested{name, (x, y), None{}, ChoiceText{text}, items}}}
    case True{} 1 1:
      Some{PutNested{Nested{name, (x, y), Some{optional}, ChoiceText{text}, items}}}
    case bad p c:
      None{}

def nested_values(name: String, +text: String, got: Maybe<&2, Bytes.SplitU32s>) -> Maybe<&2, Command>:
  match got:
    case Some{Bytes.SplitU32s{x <> y <> +present <> +optional <> +choice <> +number <> items, end}}:
      nested_flags(Bool.and(Bytes.finished(end), Bool.and(Bool.or(U32.is_ne(present, 0), U32.is_eq(optional, 0)), Bool.and(Bool.or(U32.is_ne(choice, 0), Nat.is_eq(String.length(text), 0n)), Bool.or(U32.is_ne(choice, 1), U32.is_eq(number, 0))))), name, text, x, y, present, optional, choice, number, items)
    case other:
      None{}

def nested_text(name: String, got: Maybe<&2, Bytes.SplitText>) -> Maybe<&2, Command>:
  match got:
    case None{}:
      None{}
    case Some{Bytes.SplitText{text, rest}}:
      nested_values(name, text, Bytes.take_u32s(22, rest))

def parse_nested(got: Maybe<&2, Bytes.SplitText>) -> Maybe<&2, Command>:
  match got:
    case None{}:
      None{}
    case Some{Bytes.SplitText{name, rest}}:
      nested_text(name, Bytes.take_text(24, rest))

def texts_end(tag: U32, a: String, b: String, got: Maybe<&2, Bytes.SplitText>) -> Maybe<&2, Command>:
  match got:
    case None{}:
      None{}
    case Some{Bytes.SplitText{c, end}}:
      do Maybe<&2, Command>:
        valid : Unit <- Pages.valid_unit(Bytes.finished(end))
        return SetEdit{a, b, c}

def texts_second(tag: U32, a: String, got: Maybe<&2, Bytes.SplitText>) -> Maybe<&2, Command>:
  match tag got:
    case 15 Some{Bytes.SplitText{b, rest}}:
      texts_end(tag, a, b, Bytes.take_text(24, rest))
    case 21 Some{Bytes.SplitText{b, rest}}:
      do Maybe<&2, Command>:
        valid : Unit <- Pages.valid_unit(Bytes.finished(rest))
        return MaybeAdd{a, b}
    case 22 Some{Bytes.SplitText{b, rest}}:
      do Maybe<&2, Command>:
        valid : Unit <- Pages.valid_unit(Bytes.finished(rest))
        return ResultAdd{a, b}
    case other bad:
      None{}

def texts_first(tag: U32, got: Maybe<&2, Bytes.SplitText>) -> Maybe<&2, Command>:
  match got:
    case None{}:
      None{}
    case Some{Bytes.SplitText{a, rest}}:
      texts_second(tag, a, Bytes.take_text(24, rest))

def transform_text(value: U32, got: Maybe<&2, Bytes.SplitText>) -> Maybe<&2, Command>:
  match got:
    case None{}:
      None{}
    case Some{Bytes.SplitText{text, end}}:
      do Maybe<&2, Command>:
        valid : Unit <- Pages.valid_unit(Bytes.finished(end))
        return Transform{value, text}

def number_command(tag: U32, got: Maybe<&2, Bytes.SplitU32>) -> Maybe<&2, Command>:
  match tag got:
    case 17 Some{Bytes.SplitU32{value, rest}}:
      transform_text(value, Bytes.take_text(24, rest))
    case 18 Some{Bytes.SplitU32{value, rest}}:
      do Maybe<&2, Command>:
        valid : Unit <- Pages.valid_unit(Bytes.finished(rest))
        return StoreClosure{value}
    case 19 Some{Bytes.SplitU32{value, rest}}:
      do Maybe<&2, Command>:
        valid : Unit <- Pages.valid_unit(Bytes.finished(rest))
        return ConsumeClosure{value}
    case other bad:
      None{}

def parse(payload: List<&2, U32>) -> Maybe<&2, Command>:
  match payload:
    case 13 <> rest:
      parse_nested(Bytes.take_text(24, rest))
    case [14]:
      Some{GetNested{}}
    case 15 <> rest:
      texts_first(15, Bytes.take_text(24, rest))
    case [16]:
      Some{Fold{}}
    case 17 <> rest:
      number_command(17, Bytes.take_u32(rest))
    case 18 <> rest:
      number_command(18, Bytes.take_u32(rest))
    case 19 <> rest:
      number_command(19, Bytes.take_u32(rest))
    case [20]:
      Some{Sized{}}
    case 21 <> rest:
      texts_first(21, Bytes.take_text(24, rest))
    case 22 <> rest:
      texts_first(22, Bytes.take_text(24, rest))
    case other:
      None{}
