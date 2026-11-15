import Base
import ./bytes.bend as Bytes

type State is Type:
  Workspace{records: Map<&2, String>, items: List<&2, U32>, cells: Array<U32>}

type Command is Data:
  Put{key: String, value: String}
  Get{key: String}
  Del{key: String}
  SetItems{items: List<&2, U32>}
  MapInc{}
  Sort{}
  ArraySet{index: U32, value: U32}
  ArrayGet{index: U32}
  Read{}

type InsertJob is Data:
  InsertNeed{x: U32, xs: List<&2, U32>}
  InsertCmp{ok: Bool, x: U32, h: U32, t: List<&2, U32>}

def initial() -> State:
  Workspace{Map.new(&2, String), [], Array.new(U32, 2n, 0)}

def inc(n: U32) -> U32:
  (n + 1 : U32)

def map_inc.go(xs: List<&2, U32>, acc: List<&2, U32>) -> List<&2, U32>:
  match xs:
    case Nil{}:
      List.reverse(&2, U32, acc)
    case h <> t:
      map_inc.go(t, inc(h) <> acc)

def map_inc(xs: List<&2, U32>) -> List<&2, U32>:
  map_inc.go(xs, [])

def insert.go(fuel: Nat, job: InsertJob) -> List<&2, U32>:
  match fuel:
    case 0n:
      []
    case 1n+p:
      match job:
        case InsertNeed{+x, xs}:
          match xs:
            case Nil{}:
              [x]
            case +h <> t:
              insert.go(p, InsertCmp{U32.is_le(x, h), x, h, t})
        case InsertCmp{ok, +x, +h, t}:
          match ok:
            case True{}:
              x <> (h <> t)
            case False{}:
              h <> insert.go(p, InsertNeed{x, t})

def insert(x: U32, xs: List<&2, U32>) -> List<&2, U32>:
  insert.go(64n, InsertNeed{x, xs})

def sort.go(xs: List<&2, U32>, acc: List<&2, U32>) -> List<&2, U32>:
  match xs:
    case Nil{}:
      acc
    case h <> t:
      sort.go(t, insert(h, acc))

def sort(xs: List<&2, U32>) -> List<&2, U32>:
  sort.go(xs, [])

def encode_items(tag: U32, items: List<&2, U32>) -> List<&2, U32>:
  tag <> Bytes.encode_u32s(items)

def encode_text(tag: U32, text: String) -> List<&2, U32>:
  tag <> Bytes.encode_text(text)

def encode_u32(tag: U32, n: U32) -> List<&2, U32>:
  tag <> Bytes.encode_u32(n)

def put_record(records: Map<&2, String>, +key: String, value: String) -> Map<&2, String>:
  Map.set(&2, String, records, key, value)

def got_value(found: Bool, value: String) -> List<&2, U32>:
  match found:
    case False{}:
      [2]
    case True{}:
      encode_text(1, value)

def after_get(+key: String, items: List<&2, U32>, cells: Array<U32>, got: Map<&2, String> & Maybe<&2, String>) -> State & List<&2, U32>:
  (kept, value) = got
  match value:
    case None{}:
      (Workspace{kept, items, cells}, [2])
    case Some{+text}:
      (Workspace{Map.set(&2, String, kept, key, text), items, cells}, encode_text(1, text))

def after_del(items: List<&2, U32>, cells: Array<U32>, got: Map<&2, String> & Maybe<&2, String>) -> State & List<&2, U32>:
  (kept, value) = got
  match value:
    case None{}:
      (Workspace{kept, items, cells}, [2])
    case Some{text}:
      (Workspace{kept, items, cells}, encode_text(3, text))

def array_get_at(records: Map<&2, String>, items: List<&2, U32>, got: Array<U32> & U32) -> State & List<&2, U32>:
  (cells, value) = got
  (Workspace{records, items, cells}, encode_u32(4, value))

def step(state: State, command: Command) -> State & List<&2, U32>:
  match state command:
    case Workspace{records, items, cells} Put{+key, value}:
      (Workspace{put_record(records, key, value), items, cells}, [0])
    case Workspace{records, items, cells} Get{+key}:
      after_get(key, items, cells, Map.pop(&2, String, records, key))
    case Workspace{records, items, cells} Del{key}:
      after_del(items, cells, Map.pop(&2, String, records, key))
    case Workspace{records, old, cells} SetItems{+items}:
      (Workspace{records, items, cells}, encode_items(5, items))
    case Workspace{records, items, cells} MapInc{}:
      +next = map_inc(items)
      (Workspace{records, next, cells}, encode_items(5, next))
    case Workspace{records, items, cells} Sort{}:
      +next = sort(items)
      (Workspace{records, next, cells}, encode_items(5, next))
    case Workspace{records, items, cells} ArraySet{index, value}:
      (Workspace{records, items, Array.set(U32, cells, index, value)}, [0])
    case Workspace{records, items, cells} ArrayGet{index}:
      array_get_at(records, items, Array.get(U32, cells, index))
    case Workspace{records, +items, cells} Read{}:
      (Workspace{records, items, cells}, encode_items(5, items))

def finish_put(ok: Bool, key: String, value: String) -> Maybe<&2, Command>:
  match ok:
    case True{}:
      Some{Put{key, value}}
    case False{}:
      None{}

def take_put_value(key: String, got: Maybe<&2, Bytes.SplitText>) -> Maybe<&2, Command>:
  match got:
    case None{}:
      None{}
    case Some{Bytes.SplitText{value, more}}:
      finish_put(Bytes.finished(more), key, value)

def take_put(got: Maybe<&2, Bytes.SplitText>) -> Maybe<&2, Command>:
  match got:
    case None{}:
      None{}
    case Some{Bytes.SplitText{key, rest}}:
      take_put_value(key, Bytes.take_text(96, rest))

def finish_get(ok: Bool, key: String) -> Maybe<&2, Command>:
  match ok:
    case True{}:
      Some{Get{key}}
    case False{}:
      None{}

def take_get(got: Maybe<&2, Bytes.SplitText>) -> Maybe<&2, Command>:
  match got:
    case None{}:
      None{}
    case Some{Bytes.SplitText{key, more}}:
      finish_get(Bytes.finished(more), key)

def finish_del(ok: Bool, key: String) -> Maybe<&2, Command>:
  match ok:
    case True{}:
      Some{Del{key}}
    case False{}:
      None{}

def take_del(got: Maybe<&2, Bytes.SplitText>) -> Maybe<&2, Command>:
  match got:
    case None{}:
      None{}
    case Some{Bytes.SplitText{key, more}}:
      finish_del(Bytes.finished(more), key)

def finish_items(ok: Bool, items: List<&2, U32>) -> Maybe<&2, Command>:
  match ok:
    case True{}:
      Some{SetItems{items}}
    case False{}:
      None{}

def take_items(got: Maybe<&2, Bytes.SplitU32s>) -> Maybe<&2, Command>:
  match got:
    case None{}:
      None{}
    case Some{Bytes.SplitU32s{items, more}}:
      finish_items(Bytes.finished(more), items)

def finish_aset(ok: Bool, index: U32, value: U32) -> Maybe<&2, Command>:
  match ok:
    case True{}:
      Some{ArraySet{index, value}}
    case False{}:
      None{}

def take_aset_value(index: U32, got: Maybe<&2, Bytes.SplitU32>) -> Maybe<&2, Command>:
  match got:
    case None{}:
      None{}
    case Some{Bytes.SplitU32{value, more}}:
      finish_aset(Bytes.finished(more), index, value)

def take_aset(got: Maybe<&2, Bytes.SplitU32>) -> Maybe<&2, Command>:
  match got:
    case None{}:
      None{}
    case Some{Bytes.SplitU32{index, rest}}:
      take_aset_value(index, Bytes.take_u32(rest))

def finish_aget(ok: Bool, index: U32) -> Maybe<&2, Command>:
  match ok:
    case True{}:
      Some{ArrayGet{index}}
    case False{}:
      None{}

def take_aget(got: Maybe<&2, Bytes.SplitU32>) -> Maybe<&2, Command>:
  match got:
    case None{}:
      None{}
    case Some{Bytes.SplitU32{index, more}}:
      finish_aget(Bytes.finished(more), index)

def take_command(payload: List<&2, U32>) -> Maybe<&2, Command>:
  match payload:
    case 0 <> rest:
      take_put(Bytes.take_text(96, rest))
    case 1 <> rest:
      take_get(Bytes.take_text(96, rest))
    case 2 <> rest:
      take_del(Bytes.take_text(96, rest))
    case 3 <> rest:
      take_items(Bytes.take_u32s(32, rest))
    case [4]:
      Some{MapInc{}}
    case [5]:
      Some{Sort{}}
    case 6 <> rest:
      take_aset(Bytes.take_u32(rest))
    case 7 <> rest:
      take_aget(Bytes.take_u32(rest))
    case [8]:
      Some{Read{}}
    case other:
      None{}
