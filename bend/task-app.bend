import Base
import ./bytes.bend as Bytes
import ./loop.bend as Loop
import ./task-resources.bend as Resources

type State is Type:
  Jobs{next: U32, open: Map<&2, Chan(String)>, resources: Resources.State, late: List<&2, Chan(Unit)>}

type Command is Data:
  Nap{ms: U32}
  Start{ms: U32, text: String}
  Join{id: U32}
  Timeout{limit: U32, ms: U32, text: String}
  Resource{command: Resources.Command}

def initial() -> State:
  Jobs{1, Map.new(&2, Chan(String)), Resources.initial(), []}

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

def started_ok(+id: U32, next: U32, open: Map<&2, Chan(String)>, chan: Chan(String), resources: Resources.State, late: List<&2, Chan(Unit)>) -> State & List<&2, U32>:
  (Jobs{next, Map.set(&2, Chan(String), open, Bytes.id_key(id), chan), resources, late}, encode_id(id))

def started(+next: U32, open: Map<&2, Chan(String)>, chan: Chan(String), resources: Resources.State, late: List<&2, Chan(Unit)>) -> State & List<&2, U32>:
  +id = next
  started_ok(id, (id + 1 : U32), open, chan, resources, late)

def after_wait(next: U32, open: Map<&2, Chan(String)>, text: String, resources: Resources.State, late: List<&2, Chan(Unit)>) -> State & List<&2, U32>:
  (Jobs{next, open, resources, late}, encode_text(1, text))

def with_wait(+next: U32, got: Map<&2, Chan(String)> & Maybe<&2, Chan(String)>, resources: Resources.State, late: List<&2, Chan(Unit)>) -> IO(State & List<&2, U32>):
  (open, job) = got
  match job:
    case None{}:
      IO.pure(State & List<&2, U32>, (Jobs{next, open, resources, late}, missing()))
    case Some{chan}:
      do IO<State & List<&2, U32>>:
        text : String <- IO.join(String, chan)
        return after_wait(next, open, text, resources, late)

def resource_reply(next: U32, open: Map<&2, Chan(String)>, got: Resources.State & List<&2, U32>, late: List<&2, Chan(Unit)>) -> State & List<&2, U32>:
  (resources, reply) = got
  (Jobs{next, open, resources, late}, reply)

def start_job(available: Bool, +next: U32, open: Map<&2, Chan(String)>, resources: Resources.State, late: List<&2, Chan(Unit)>, ms: U32, text: String) -> IO(State & List<&2, U32>):
  match available:
    case False{}:
      IO.pure(State & List<&2, U32>, (Jobs{next, open, resources, late}, Bytes.encode_error((75, "job IDs exhausted"))))
    case True{}:
      do IO<State & List<&2, U32>>:
        chan : Chan(String) <- IO.fork(String, nap(ms, text))
        return started(next, open, chan, resources, late)

def tracked_nap(ms: U32, text: String, ack: Chan(Unit)) -> IO(String):
  do IO<String>:
    value : String <- nap(ms, text)
    sent : Result<&1, &1, Unit, Unit> <- Chan.send(Unit, ack, Unit{})
    return value

def keep_pending(got: Poll<&1, &1, Maybe<&1, Unit>, Unit>, ack: Chan(Unit), kept: List<&2, Chan(Unit)>) -> IO(List<&2, Chan(Unit)>):
  match got:
    case Ready{value}:
      do IO<List<&2, Chan(Unit)>>:
        Unit <- Chan.close(Unit, ack)
        return kept
    case Wait{rest}:
      IO.pure(List<&2, Chan(Unit)>, ack <> kept)

def reap_late(late: List<&2, Chan(Unit)>, kept: List<&2, Chan(Unit)>) -> IO(List<&2, Chan(Unit)>):
  match late:
    case Nil{}:
      IO.pure(List<&2, Chan(Unit)>, kept)
    case +ack <> rest:
      do IO<List<&2, Chan(Unit)>>:
        got : Poll<&1, &1, Maybe<&1, Unit>, Unit> <- Chan.try_recv(Unit, ack, 0)
        pending : List<&2, Chan(Unit)> <- keep_pending(got, ack, kept)
        reap_late(rest, pending)

def timeout_completed(next: U32, open: Map<&2, Chan(String)>, resources: Resources.State, late: List<&2, Chan(Unit)>, ack: Chan(Unit), got: Maybe<&1, String>) -> IO(State & List<&2, U32>):
  match got:
    case None{}:
      IO.pure(State & List<&2, U32>, (Jobs{next, open, resources, ack <> late}, [5]))
    case Some{text}:
      do IO<State & List<&2, U32>>:
        Unit <- IO.join(Unit, ack)
        return (Jobs{next, open, resources, late}, encode_text(1, text))

def pending_limit() -> Nat:
  16n

def timeout_job(available: Bool, next: U32, open: Map<&2, Chan(String)>, resources: Resources.State, late: List<&2, Chan(Unit)>, limit: U32, ms: U32, text: String) -> IO(State & List<&2, U32>):
  match available:
    case False{}:
      IO.pure(State & List<&2, U32>, (Jobs{next, open, resources, late}, Bytes.encode_error((75, "timeout jobs full"))))
    case True{}:
      do IO<State & List<&2, U32>>:
        +ack : Chan(Unit) <- Chan.new(Unit, 1)
        got : Maybe<&1, String> <- IO.within(String, limit, tracked_nap(ms, text, ack))
        timeout_completed(next, open, resources, late, ack, got)

def step_ready(state: State, command: Command) -> IO(State & List<&2, U32>):
  match state command:
    case Jobs{next, open, resources, late} Nap{ms}:
      do IO<State & List<&2, U32>>:
        Unit <- IO.sleep(ms)
        return (Jobs{next, open, resources, late}, Loop.ok())
    case Jobs{+next, open, resources, late} Start{ms, text}:
      start_job(U32.is_ne(next, 0), next, open, resources, late, ms, text)
    case Jobs{+next, open, resources, late} Join{id}:
      with_wait(next, Map.pop(&2, Chan(String), open, Bytes.id_key(id)), resources, late)
    case Jobs{next, open, resources, +late} Timeout{limit, ms, text}:
      timeout_job(Nat.is_lt(List.length(&2, Chan(Unit), late), pending_limit()), next, open, resources, late, limit, ms, text)
    case Jobs{next, open, resources, late} Resource{command}:
      do IO<State & List<&2, U32>>:
        got : Resources.State & List<&2, U32> <- Resources.step(command, resources)
        return resource_reply(next, open, got, late)

def step(state: State, command: Command) -> IO(State & List<&2, U32>):
  match state:
    case Jobs{next, open, resources, late}:
      do IO<State & List<&2, U32>>:
        pending : List<&2, Chan(Unit)> <- reap_late(late, [])
        step_ready(Jobs{next, open, resources, pending}, command)

def close_list(jobs: List<&2, Chan(String)>) -> IO(Unit):
  match jobs:
    case Nil{}:
      IO.pure(Unit, Unit{})
    case h <> t:
      do IO<Unit>:
        text : String <- IO.join(String, h)
        close_list(t)

def drain_late(late: List<&2, Chan(Unit)>) -> IO(Unit):
  match late:
    case Nil{}:
      IO.pure(Unit, Unit{})
    case h <> t:
      do IO<Unit>:
        Unit <- IO.join(Unit, h)
        drain_late(t)

def shutdown(state: State) -> IO(Unit):
  match state:
    case Jobs{next, open, resources, late}:
      do IO<Unit>:
        Unit <- Resources.shutdown(resources)
        Unit <- drain_late(late)
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
    case Some{Bytes.SplitU32{+ms, more}}:
      finish_nap(Bool.and(Bytes.finished(more), U32.is_le(ms, 10000)), ms)

def finish_start(ok: Bool, ms: U32, text: String) -> Maybe<&2, Command>:
  match ok:
    case True{}:
      Some{Start{ms, text}}
    case False{}:
      None{}

def take_start_text(+ms: U32, got: Maybe<&2, Bytes.SplitText>) -> Maybe<&2, Command>:
  match got:
    case None{}:
      None{}
    case Some{Bytes.SplitText{text, more}}:
      finish_start(Bool.and(Bytes.finished(more), U32.is_le(ms, 10000)), ms, text)

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
    case Some{Bytes.SplitU32{+id, more}}:
      finish_wait(Bool.and(Bytes.finished(more), U32.is_ge(id, 1)), id)

def finish_timeout(ok: Bool, limit: U32, ms: U32, text: String) -> Maybe<&2, Command>:
  match ok:
    case True{}:
      Some{Timeout{limit, ms, text}}
    case False{}:
      None{}

def take_timeout_text(+limit: U32, +ms: U32, got: Maybe<&2, Bytes.SplitText>) -> Maybe<&2, Command>:
  match got:
    case None{}:
      None{}
    case Some{Bytes.SplitText{text, more}}:
      finish_timeout(Bool.and(Bytes.finished(more), Bool.and(U32.is_le(limit, 10000), U32.is_le(ms, 10000))), limit, ms, text)

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

def resource_command(got: Maybe<&2, Resources.Command>) -> Maybe<&2, Command>:
  match got:
    case None{}:
      None{}
    case Some{command}:
      Some{Resource{command}}

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
      resource_command(Resources.take_command(other))
