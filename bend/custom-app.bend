import Base
import ./bytes.bend as Bytes

type Receipt is Data:
  Receipt{value: U32, tag: U32}

type Outcome is Data:
  Success{tag: U32, value: U32}
  Failure{code: U32, message: String}

type State is Data:
  CustomState{results: List<&2, Outcome>}

type Command is Data:
  Mark{path: String}
  Immediate{value: U32}
  Write{path: String, text: String}
  Parked{milliseconds: U32, value: U32}
  History{offset: U32}

def initial() -> State:
  CustomState{[]}

def write(path: String, text: String) -> IO(Result<&1, &1, U32 & String, Receipt>):
  import "./custom-mark.c"
  import "./custom-mark.js"

def immediate(value: U32) -> IO(Receipt):
  import "./custom-immediate.c"
  import "./custom-immediate.js"

def parked(milliseconds: U32, value: U32) -> IO(Receipt):
  import "./custom-parked.c"
  import "./custom-parked.js"

def encode(outcome: Outcome) -> List<&2, U32>:
  match outcome:
    case Success{tag, value}:
      tag <> Bytes.encode_u32(value)
    case Failure{code, message}:
      Bytes.encode_error((code, message))

def encode_page(results: List<&2, Outcome>) -> List<&2, U32>:
  match results:
    case Nil{}:
      [0]
    case h <> Nil{}:
      1 <> encode(h)
    case h <> t <> rest:
      2 <> List.append(&2, U32, encode(h), encode(t))

def page(offset: Nat, results: List<&2, Outcome>) -> List<&2, U32>:
  match offset:
    case 0n:
      encode_page(results)
    case 1n+p:
      match results:
        case Nil{}:
          [0]
        case h <> t:
          page(p, t)

def history(valid: Bool, +results: List<&2, Outcome>, +offset: U32, total: U32) -> State & List<&2, U32>:
  match valid:
    case False{}:
      (CustomState{results}, Bytes.encode_error((22, "custom history offset exceeds total")))
    case True{}:
      (CustomState{results}, 5 <> List.append(&2, U32, Bytes.encode_u32(offset), List.append(&2, U32, Bytes.encode_u32(total), page(U32.to_nat(offset), results))))

def retain(+results: List<&2, Outcome>, +outcome: Outcome) -> State & List<&2, U32>:
  (CustomState{List.append(&2, Outcome, results, [outcome])}, encode(outcome))

def completed(results: List<&2, Outcome>, tag: U32, result: Result<&1, &1, U32 & String, Receipt>) -> State & List<&2, U32>:
  match result:
    case Done{Receipt{value, _}}:
      retain(results, Success{tag, value})
    case Fail{(code, message)}:
      retain(results, Failure{code, message})

def received(results: List<&2, Outcome>, receipt: Receipt) -> State & List<&2, U32>:
  match receipt:
    case Receipt{value, tag}:
      retain(results, Success{tag, value})

def execute(+results: List<&2, Outcome>, command: Command) -> IO(State & List<&2, U32>):
  match command:
    case Mark{path}:
      do IO<State & List<&2, U32>>:
        result : Result<&1, &1, U32 & String, Receipt> <- write(path, "custom\n")
        return completed(results, 0, result)
    case Write{path, text}:
      do IO<State & List<&2, U32>>:
        result : Result<&1, &1, U32 & String, Receipt> <- write(path, text)
        return completed(results, 3, result)
    case Immediate{value}:
      do IO<State & List<&2, U32>>:
        result : Receipt <- immediate(value)
        return received(results, result)
    case Parked{milliseconds, value}:
      do IO<State & List<&2, U32>>:
        result : Receipt <- parked(milliseconds, value)
        return received(results, result)
    case History{+offset}:
      +total = U32.from_nat(List.length(&2, Outcome, results))
      IO.pure(State & List<&2, U32>, history(U32.is_le(offset, total), results, offset, total))

def bounded(full: Bool, results: List<&2, Outcome>, command: Command) -> IO(State & List<&2, U32>):
  match full:
    case True{}:
      IO.pure(State & List<&2, U32>, (CustomState{results}, Bytes.encode_error((75, "custom history is full"))))
    case False{}:
      execute(results, command)

def step(state: State, command: Command) -> IO(State & List<&2, U32>):
  match state:
    case CustomState{+results}:
      match command:
        case History{+offset}:
          +total = U32.from_nat(List.length(&2, Outcome, results))
          IO.pure(State & List<&2, U32>, history(U32.is_le(offset, total), results, offset, total))
        case other:
          bounded(Nat.is_ge(List.length(&2, Outcome, results), 32n), results, other)

def finish(ok: Bool, command: Command) -> Maybe<&2, Command>:
  match ok:
    case True{}:
      Some{command}
    case False{}:
      None{}

def no_nul(path: String) -> Bool:
  match path:
    case SNil{}:
      True{}
    case SCon{c, t}:
      Bool.not(Char.is_eq(c, '\0')) && no_nul(t)

def valid_path(path: String) -> Bool:
  match path:
    case SNil{}:
      False{}
    case SCon{c, t}:
      Bool.not(Char.is_eq(c, '\0')) && no_nul(t)

def take_write_text(+path: String, got: Maybe<&2, Bytes.SplitText>) -> Maybe<&2, Command>:
  match got:
    case None{}:
      None{}
    case Some{Bytes.SplitText{text, rest}}:
      finish(valid_path(path) && Bytes.finished(rest), Write{path, text})

def take_path(got: Maybe<&2, Bytes.SplitText>, tag: U32) -> Maybe<&2, Command>:
  match got:
    case None{}:
      None{}
    case Some{Bytes.SplitText{+path, rest}}:
      match tag:
        case 0:
          finish(valid_path(path) && Bytes.finished(rest), Mark{path})
        case other:
          take_write_text(path, Bytes.take_text(149, rest))

def take_value(got: Maybe<&2, Bytes.SplitU32>) -> Maybe<&2, Command>:
  match got:
    case None{}:
      None{}
    case Some{Bytes.SplitU32{value, rest}}:
      finish(Bytes.finished(rest), Immediate{value})

def take_parked_value(+ms: U32, got: Maybe<&2, Bytes.SplitU32>) -> Maybe<&2, Command>:
  match got:
    case None{}:
      None{}
    case Some{Bytes.SplitU32{value, rest}}:
      finish(U32.is_le(ms, 10000) && Bytes.finished(rest), Parked{ms, value})

def take_parked(got: Maybe<&2, Bytes.SplitU32>) -> Maybe<&2, Command>:
  match got:
    case None{}:
      None{}
    case Some{Bytes.SplitU32{ms, rest}}:
      take_parked_value(ms, Bytes.take_u32(rest))

def take_history(got: Maybe<&2, Bytes.SplitU32>) -> Maybe<&2, Command>:
  match got:
    case None{}:
      None{}
    case Some{Bytes.SplitU32{+offset, rest}}:
      finish(U32.is_le(offset, 32) && Bytes.finished(rest), History{offset})

def take_command(payload: List<&2, U32>) -> Maybe<&2, Command>:
  match payload:
    case 0 <> rest:
      take_path(Bytes.take_text(96, rest), 0)
    case 1 <> rest:
      take_value(Bytes.take_u32(rest))
    case 3 <> rest:
      take_path(Bytes.take_text(96, rest), 3)
    case 4 <> rest:
      take_parked(Bytes.take_u32(rest))
    case 5 <> rest:
      take_history(Bytes.take_u32(rest))
    case other:
      None{}
