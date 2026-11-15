import Base
import ./bytes.bend as Bytes
import ./loop.bend as Loop

type State is Type:
  Jobs{next: U32, open: Map<&2, Chan(String)>}

type Command is Data:
  Nap{ms: U32}
  Start{ms: U32, text: String}
  Join{id: U32}
  Timeout{limit: U32, ms: U32, text: String}

def initial() -> State:
  Jobs{1, Map.new(&2, Chan(String))}

def encode_fail(error: U32 & String) -> List<&2, U32>:
  (code, message) = error
  2 <> List.append(&2, U32, Bytes.encode_u32(code), Bytes.encode_text(message))

def encode_id(id: U32) -> List<&2, U32>:
  0 <> Bytes.encode_u32(id)

def encode_text(tag: U32, text: String) -> List<&2, U32>:
  tag <> Bytes.encode_text(text)

def missing() -> List<&2, U32>:
  [3]

def nap(ms: U32, +text: String) -> IO(String):
  do IO<String>:
    Unit <- IO.sleep(ms)
    Unit <- IO.print(text)
    return text

def started_ok(+id: U32, next: U32, open: Map<&2, Chan(String)>, chan: Chan(String)) -> State & List<&2, U32>:
  (Jobs{next, Map.set(&2, Chan(String), open, Bytes.id_key(id), chan)}, encode_id(id))

def started(+next: U32, open: Map<&2, Chan(String)>, chan: Chan(String)) -> State & List<&2, U32>:
  +id = next
  started_ok(id, (id + 1 : U32), open, chan)

def after_wait(next: U32, open: Map<&2, Chan(String)>, text: String) -> State & List<&2, U32>:
  (Jobs{next, open}, encode_text(1, text))

def with_wait(+next: U32, got: Map<&2, Chan(String)> & Maybe<&2, Chan(String)>) -> IO(State & List<&2, U32>):
  (open, job) = got
  match job:
    case None{}:
      IO.pure(State & List<&2, U32>, (Jobs{next, open}, missing()))
    case Some{chan}:
      do IO<State & List<&2, U32>>:
        text : String <- IO.join(String, chan)
        return after_wait(next, open, text)

def timeout_reply(got: Maybe<&1, String>) -> List<&2, U32>:
  match got:
    case None{}:
      [5]
    case Some{text}:
      encode_text(1, text)

def step(state: State, command: Command) -> IO(State & List<&2, U32>):
  match state command:
    case Jobs{next, open} Nap{ms}:
      do IO<State & List<&2, U32>>:
        Unit <- IO.sleep(ms)
        return (Jobs{next, open}, Loop.ok())
    case Jobs{+next, open} Start{ms, text}:
      do IO<State & List<&2, U32>>:
        chan : Chan(String) <- IO.fork(String, nap(ms, text))
        return started(next, open, chan)
    case Jobs{+next, open} Join{id}:
      with_wait(next, Map.pop(&2, Chan(String), open, Bytes.id_key(id)))
    case Jobs{next, open} Timeout{limit, ms, text}:
      do IO<State & List<&2, U32>>:
        got : Maybe<&1, String> <- IO.within(String, limit, nap(ms, text))
        return (Jobs{next, open}, timeout_reply(got))

def close_list(jobs: List<&2, Chan(String)>) -> IO(Unit):
  match jobs:
    case Nil{}:
      IO.pure(Unit, Unit{})
    case h <> t:
      do IO<Unit>:
        Unit <- Chan.close(String, h)
        close_list(t)

def shutdown(state: State) -> IO(Unit):
  match state:
    case Jobs{next, open}:
      close_list(Map.values(&2, Chan(String), open))

def finish_nap(ok: Bool, ms: U32) -> Maybe<&2, Command>:
  match ok:
    case True{}:
      Some{Nap{ms}}
    case False{}:
      None{}

def take_nap(got: Maybe<&2, Bytes.SplitU32>) -> Maybe<&2, Command>:
  match got:
    case None{}:
      None{}
    case Some{Bytes.SplitU32{ms, more}}:
      finish_nap(Bytes.finished(more), ms)

def finish_start(ok: Bool, ms: U32, text: String) -> Maybe<&2, Command>:
  match ok:
    case True{}:
      Some{Start{ms, text}}
    case False{}:
      None{}

def take_start_text(ms: U32, got: Maybe<&2, Bytes.SplitText>) -> Maybe<&2, Command>:
  match got:
    case None{}:
      None{}
    case Some{Bytes.SplitText{text, more}}:
      finish_start(Bytes.finished(more), ms, text)

def take_start(got: Maybe<&2, Bytes.SplitU32>) -> Maybe<&2, Command>:
  match got:
    case None{}:
      None{}
    case Some{Bytes.SplitU32{ms, rest}}:
      take_start_text(ms, Bytes.take_text(64, rest))

def finish_wait(ok: Bool, id: U32) -> Maybe<&2, Command>:
  match ok:
    case True{}:
      Some{Join{id}}
    case False{}:
      None{}

def take_wait(got: Maybe<&2, Bytes.SplitU32>) -> Maybe<&2, Command>:
  match got:
    case None{}:
      None{}
    case Some{Bytes.SplitU32{id, more}}:
      finish_wait(Bytes.finished(more), id)

def finish_timeout(ok: Bool, limit: U32, ms: U32, text: String) -> Maybe<&2, Command>:
  match ok:
    case True{}:
      Some{Timeout{limit, ms, text}}
    case False{}:
      None{}

def take_timeout_text(limit: U32, ms: U32, got: Maybe<&2, Bytes.SplitText>) -> Maybe<&2, Command>:
  match got:
    case None{}:
      None{}
    case Some{Bytes.SplitText{text, more}}:
      finish_timeout(Bytes.finished(more), limit, ms, text)

def take_timeout_ms(limit: U32, got: Maybe<&2, Bytes.SplitU32>) -> Maybe<&2, Command>:
  match got:
    case None{}:
      None{}
    case Some{Bytes.SplitU32{ms, rest}}:
      take_timeout_text(limit, ms, Bytes.take_text(32, rest))

def take_timeout(got: Maybe<&2, Bytes.SplitU32>) -> Maybe<&2, Command>:
  match got:
    case None{}:
      None{}
    case Some{Bytes.SplitU32{limit, rest}}:
      take_timeout_ms(limit, Bytes.take_u32(rest))

def take_command(payload: List<&2, U32>) -> Maybe<&2, Command>:
  match payload:
    case 0 <> rest:
      take_nap(Bytes.take_u32(rest))
    case 1 <> rest:
      take_start(Bytes.take_u32(rest))
    case 2 <> rest:
      take_wait(Bytes.take_u32(rest))
    case 3 <> rest:
      take_timeout(Bytes.take_u32(rest))
    case other:
      None{}
