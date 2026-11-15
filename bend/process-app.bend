import Base
import ./bytes.bend as Bytes
import ./loop.bend as Loop

type State is Data:
  ProcessIdle{}

type Command is Data:
  Env{name: String}
  Args{}
  Run{program: String, arg: String, input: String}
  Random{}
  Fixture{behavior: U32, arg: String, input: String}

def initial() -> State:
  ProcessIdle{}

def encode_fail(error: U32 & String) -> List<&2, U32>:
  Bytes.encode_error(error)

def encode_text(tag: U32, text: String) -> List<&2, U32>:
  Bytes.text_reply(tag, text)

def encode_u32(tag: U32, n: U32) -> List<&2, U32>:
  tag <> Bytes.encode_u32(n)

def join_args.go(xs: List<String>, acc: String) -> String:
  match xs:
    case Nil{}:
      acc
    case h <> t:
      join_args.go(t, acc ++ "\n" ++ h)

def join_args(xs: List<String>) -> String:
  match xs:
    case Nil{}:
      ""
    case h <> t:
      join_args.go(t, h)

def env_reply(result: Result<&1, &1, U32 & String, String>) -> List<&2, U32>:
  match result:
    case Fail{error}:
      encode_fail(error)
    case Done{value}:
      encode_text(1, value)

def run_reply_bounded(fits: Bool, code: U32, out: List<&2, U32>, err: List<&2, U32>) -> List<&2, U32>:
  match fits:
    case False{}:
      encode_fail((75, "reply exceeds text bound"))
    case True{}:
      3 <> List.append(&2, U32, Bytes.encode_u32(code), List.append(&2, U32, Bytes.encode_len_bytes(out), Bytes.encode_len_bytes(err)))

def run_reply(result: Result<&1, &1, U32 & String, U32 & (String & String)>) -> List<&2, U32>:
  match result:
    case Fail{error}:
      encode_fail(error)
    case Done{got}:
      (code, streams) = got
      (out, err) = streams
      +out_bytes = Bytes.encode_text.go(out, [])
      +err_bytes = Bytes.encode_text.go(err, [])
      run_reply_bounded(Bool.and(Nat.is_le(List.length(&2, U32, out_bytes), 96n), Nat.is_le(List.length(&2, U32, err_bytes), 96n)), code, out_bytes, err_bytes)

def random_reply(result: Result<&1, &1, U32 & String, U32>) -> List<&2, U32>:
  match result:
    case Fail{error}:
      encode_fail(error)
    case Done{n}:
      encode_u32(4, n)

def fixture_name(behavior: U32) -> String:
  match behavior:
    case 0:
      "report"
    case 1:
      "success"
    case 2:
      "timeout"
    case other:
      "overflow"

def fixture_run(got: Result<&1, &1, U32 & String, String>, behavior: U32, arg: String, input: String) -> IO(List<&2, U32>):
  match got:
    case Fail{error}:
      IO.pure(List<&2, U32>, encode_fail(error))
    case Done{program}:
      do IO<List<&2, U32>>:
        result : Result<&1, &1, U32 & String, U32 & (String & String)> <- Process.run(program, [fixture_name(behavior), arg], input, 192, 200)
        return run_reply(result)

def step(state: State, command: Command) -> IO(State & List<&2, U32>):
  match command:
    case Env{name}:
      do IO<State & List<&2, U32>>:
        result : Result<&1, &1, U32 & String, String> <- IO.get_env(name)
        return (state, env_reply(result))
    case Args{}:
      do IO<State & List<&2, U32>>:
        args : List<String> <- IO.args()
        return (state, encode_text(1, join_args(args)))
    case Run{program, arg, input}:
      do IO<State & List<&2, U32>>:
        result : Result<&1, &1, U32 & String, U32 & (String & String)> <- Process.run(program, [arg], input, 192, 2000)
        return (state, run_reply(result))
    case Random{}:
      do IO<State & List<&2, U32>>:
        result : Result<&1, &1, U32 & String, U32> <- IO.random_u32()
        return (state, random_reply(result))
    case Fixture{behavior, arg, input}:
      do IO<State & List<&2, U32>>:
        program : Result<&1, &1, U32 & String, String> <- IO.get_env("BENDFLOW_PROCESS_FIXTURE")
        reply : List<&2, U32> <- fixture_run(program, behavior, arg, input)
        return (state, reply)

def valid_chars(name: String, +env: Bool) -> Bool:
  match name:
    case SNil{}:
      True{}
    case SCon{+h, t}:
      Bool.and(U32.is_ne(Char.to_u32(h), 0), Bool.and(Bool.or(Bool.not(env), U32.is_ne(Char.to_u32(h), 61)), valid_chars(t, env)))

def nonempty(name: String) -> Bool:
  match name:
    case SNil{}:
      False{}
    case SCon{h, t}:
      True{}

def finish_env(ok: Bool, name: String) -> Maybe<&2, Command>:
  match ok:
    case True{}:
      Some{Env{name}}
    case False{}:
      None{}

def take_env(got: Maybe<&2, Bytes.SplitText>) -> Maybe<&2, Command>:
  match got:
    case None{}:
      None{}
    case Some{Bytes.SplitText{+name, more}}:
      finish_env(Bool.and(Bytes.finished(more), Bool.and(nonempty(name), valid_chars(name, True{}))), name)

def finish_run(ok: Bool, program: String, arg: String, input: String) -> Maybe<&2, Command>:
  match ok:
    case True{}:
      Some{Run{program, arg, input}}
    case False{}:
      None{}

def take_run_input(program: String, arg: String, got: Maybe<&2, Bytes.SplitText>) -> Maybe<&2, Command>:
  match got:
    case None{}:
      None{}
    case Some{Bytes.SplitText{input, more}}:
      finish_run(Bytes.finished(more), program, arg, input)

def take_run_arg_checked(ok: Bool, program: String, arg: String, rest: List<&2, U32>) -> Maybe<&2, Command>:
  match ok:
    case True{}:
      take_run_input(program, arg, Bytes.take_text(64, rest))
    case False{}:
      None{}

def take_run_arg(program: String, got: Maybe<&2, Bytes.SplitText>) -> Maybe<&2, Command>:
  match got:
    case None{}:
      None{}
    case Some{Bytes.SplitText{+arg, rest}}:
      take_run_arg_checked(valid_chars(arg, False{}), program, arg, rest)

def take_run_checked(ok: Bool, program: String, rest: List<&2, U32>) -> Maybe<&2, Command>:
  match ok:
    case True{}:
      take_run_arg(program, Bytes.take_text(64, rest))
    case False{}:
      None{}

def take_run(got: Maybe<&2, Bytes.SplitText>) -> Maybe<&2, Command>:
  match got:
    case None{}:
      None{}
    case Some{Bytes.SplitText{+program, rest}}:
      take_run_checked(Bool.and(nonempty(program), valid_chars(program, False{})), program, rest)

def fixture_input(behavior: U32, arg: String, got: Maybe<&2, Bytes.SplitText>) -> Maybe<&2, Command>:
  match got:
    case Some{Bytes.SplitText{input, []}}:
      Some{Fixture{behavior, arg, input}}
    case other:
      None{}

def fixture_arg_checked(ok: Bool, behavior: U32, arg: String, rest: List<&2, U32>) -> Maybe<&2, Command>:
  match ok:
    case True{}:
      fixture_input(behavior, arg, Bytes.take_text(32, rest))
    case False{}:
      None{}

def fixture_arg(behavior: U32, got: Maybe<&2, Bytes.SplitText>) -> Maybe<&2, Command>:
  match got:
    case Some{Bytes.SplitText{+arg, rest}}:
      fixture_arg_checked(valid_chars(arg, False{}), behavior, arg, rest)
    case other:
      None{}

def fixture_behavior_checked(ok: Bool, behavior: U32, rest: List<&2, U32>) -> Maybe<&2, Command>:
  match ok:
    case True{}:
      fixture_arg(behavior, Bytes.take_text(32, rest))
    case False{}:
      None{}

def fixture_behavior(got: Maybe<&2, Bytes.SplitU32>) -> Maybe<&2, Command>:
  match got:
    case Some{Bytes.SplitU32{+behavior, rest}}:
      fixture_behavior_checked(U32.is_le(behavior, 3), behavior, rest)
    case other:
      None{}

def take_command(payload: List<&2, U32>) -> Maybe<&2, Command>:
  match payload:
    case 0 <> rest:
      take_env(Bytes.take_text(96, rest))
    case [1]:
      Some{Args{}}
    case 2 <> rest:
      take_run(Bytes.take_text(96, rest))
    case [3]:
      Some{Random{}}
    case 4 <> rest:
      fixture_behavior(Bytes.take_u8(rest))
    case other:
      None{}
