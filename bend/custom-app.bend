import Base
import ./bytes.bend as Bytes

type State is Data:
  CustomIdle{}

type Command is Data:
  Mark{path: String}

def initial() -> State:
  CustomIdle{}

def mark(path: String) -> IO(Result<&1, &1, U32 & String, U32>):
  import "./custom-mark.c"
  import "./custom-mark.js"

def encode_fail(error: U32 & String) -> List<&2, U32>:
  Bytes.encode_error(error)

def marked(result: Result<&1, &1, U32 & String, U32>) -> List<&2, U32>:
  match result:
    case Fail{error}:
      encode_fail(error)
    case Done{n}:
      0 <> Bytes.encode_u32(n)

def step(state: State, command: Command) -> IO(State & List<&2, U32>):
  match command:
    case Mark{path}:
      do IO<State & List<&2, U32>>:
        result : Result<&1, &1, U32 & String, U32> <- mark(path)
        return (state, marked(result))

def finish_mark(ok: Bool, path: String) -> Maybe<&2, Command>:
  match ok:
    case True{}:
      Some{Mark{path}}
    case False{}:
      None{}

def take_mark(got: Maybe<&2, Bytes.SplitText>) -> Maybe<&2, Command>:
  match got:
    case None{}:
      None{}
    case Some{Bytes.SplitText{path, more}}:
      finish_mark(Bytes.finished(more), path)

def take_command(payload: List<&2, U32>) -> Maybe<&2, Command>:
  match payload:
    case 0 <> rest:
      take_mark(Bytes.take_text(96, rest))
    case other:
      None{}
