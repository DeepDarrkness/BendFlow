import Base
import ./bytes.bend as Bytes

type State is Type:
  Empty{}
  Foreground{file: File}
  Background{gate: Chan(Unit), result: Chan(File & List<&2, U32>), ack: Chan(Unit)}
  Completed{result: Chan(File & List<&2, U32>)}

type Command is Data:
  Channels{text: String}
  OpenFile{path: String}
  WriteFile{text: String}
  Transfer{text: String}
  Release{}
  Collect{}
  CloseFile{}

def initial() -> State:
  Empty{}

def write_reply(got: Result<&1, &1, U32 & String, Unit>) -> List<&2, U32>:
  match got:
    case Done{u}:
      [0]
    case Fail{error}:
      Bytes.encode_error(error)

def open_reply(got: Result<&1, &1, U32 & String, File>) -> State & List<&2, U32>:
  match got:
    case Done{file}:
      (Foreground{file}, [0])
    case Fail{error}:
      (Empty{}, Bytes.encode_error(error))

def written(got: File & Result<&1, &1, U32 & String, Unit>) -> File & List<&2, U32>:
  (file, reply) = got
  (file, write_reply(reply))

def foreground(got: File & List<&2, U32>) -> State & List<&2, U32>:
  (file, reply) = got
  (Foreground{file}, reply)

def gated_write(got: Maybe<&1, Unit>, file: File, text: String) -> IO(File & List<&2, U32>):
  match got:
    case None{}:
      IO.pure(File & List<&2, U32>, (file, [3]))
    case Some{u}:
      do IO<File & List<&2, U32>>:
        wrote : File & Result<&1, &1, U32 & String, Unit> <- File.write(file, text)
        return written(wrote)

def background(file: File, text: String, gate: Chan(Unit), ready: Chan(Unit), ack: Chan(Unit)) -> IO(File & List<&2, U32>):
  do IO<File & List<&2, U32>>:
    sent : Result<&1, &1, Unit, Unit> <- Chan.send(Unit, ready, Unit{})
    signal : Maybe<&1, Unit> <- Chan.recv(Unit, gate)
    result : File & List<&2, U32> <- gated_write(signal, file, text)
    sent : Result<&1, &1, Unit, Unit> <- Chan.send(Unit, ack, Unit{})
    return result

def channel_deliver(got: Maybe<&1, String>, ack: Chan(String)) -> IO(Unit):
  match got:
    case None{}:
      Chan.close(String, ack)
    case Some{text}:
      do IO<Unit>:
        sent : Result<&1, &1, String, Unit> <- Chan.send(String, ack, text)
        return Unit{}

def channel_worker(+gate: Chan(String), ack: Chan(String)) -> IO(Unit):
  do IO<Unit>:
    got : Maybe<&1, String> <- Chan.recv(String, gate)
    Unit <- Chan.close(String, gate)
    channel_deliver(got, ack)

def closed_valid(ok: Bool, text: String) -> List<&2, U32>:
  match ok:
    case True{}:
      Bytes.text_reply(1, text)
    case False{}:
      Bytes.encode_error((1, "channel close invariant"))

def closed_reply(sent: Result<&1, &1, String, Unit>, got: Maybe<&1, String>, text: String) -> List<&2, U32>:
  match sent got:
    case Fail{value} None{}:
      closed_valid(String.eq(value, "must return"), text)
    case other rest:
      Bytes.encode_error((1, "channel close invariant"))

def channels(text: String) -> IO(List<&2, U32>):
  do IO<List<&2, U32>>:
    +gate : Chan(String) <- Chan.new(String, 0)
    +ack : Chan(String) <- Chan.new(String, 0)
    Unit <- IO.spawn(Unit, channel_worker(gate, ack))
    sent : Result<&1, &1, String, Unit> <- Chan.send(String, gate, text)
    value : String <- IO.join(String, ack)
    closed : Result<&1, &1, String, Unit> <- Chan.send(String, gate, "must return")
    drained : Maybe<&1, String> <- Chan.recv(String, ack)
    return closed_reply(closed, drained, value)

def step(command: Command, state: State) -> IO(State & List<&2, U32>):
  match command:
    case Channels{text}:
      do IO<State & List<&2, U32>>:
        reply : List<&2, U32> <- channels(text)
        return (state, reply)
    case OpenFile{path}:
      match state:
        case Empty{}:
          do IO<State & List<&2, U32>>:
            got : Result<&1, &1, U32 & String, File> <- File.open(path, "w")
            return open_reply(got)
        case other:
          IO.pure(State & List<&2, U32>, (other, [3]))
    case WriteFile{text}:
      match state:
        case Foreground{file}:
          do IO<State & List<&2, U32>>:
            got : File & Result<&1, &1, U32 & String, Unit> <- File.write(file, text)
            return foreground(written(got))
        case other:
          IO.pure(State & List<&2, U32>, (other, [3]))
    case Transfer{text}:
      match state:
        case Foreground{file}:
          do IO<State & List<&2, U32>>:
            +gate : Chan(Unit) <- Chan.new(Unit, 1)
            +ready : Chan(Unit) <- Chan.new(Unit, 1)
            +ack : Chan(Unit) <- Chan.new(Unit, 1)
            result : Chan(File & List<&2, U32>) <- IO.fork(File & List<&2, U32>, background(file, text, gate, ready, ack))
            Unit <- IO.join(Unit, ready)
            return (Background{gate, result, ack}, [0])
        case other:
          IO.pure(State & List<&2, U32>, (other, [3]))
    case Release{}:
      match state:
        case Background{+gate, result, ack}:
          do IO<State & List<&2, U32>>:
            sent : Result<&1, &1, Unit, Unit> <- Chan.send(Unit, gate, Unit{})
            Unit <- IO.join(Unit, ack)
            Unit <- Chan.close(Unit, gate)
            return (Completed{result}, [0])
        case other:
          IO.pure(State & List<&2, U32>, (other, [3]))
    case Collect{}:
      match state:
        case Completed{result}:
          do IO<State & List<&2, U32>>:
            got : File & List<&2, U32> <- IO.join(File & List<&2, U32>, result)
            return foreground(got)
        case other:
          IO.pure(State & List<&2, U32>, (other, [3]))
    case CloseFile{}:
      match state:
        case Foreground{file}:
          do IO<State & List<&2, U32>>:
            Unit <- File.close(file)
            return (Empty{}, [0])
        case other:
          IO.pure(State & List<&2, U32>, (other, [3]))

def close_file(got: File & List<&2, U32>) -> IO(Unit):
  (file, reply) = got
  do IO<Unit>:
    Unit <- File.close(file)
    IO.print("task-file-closed")

def close_result(result: Chan(File & List<&2, U32>)) -> IO(Unit):
  do IO<Unit>:
    got : File & List<&2, U32> <- IO.join(File & List<&2, U32>, result)
    close_file(got)

def shutdown(state: State) -> IO(Unit):
  match state:
    case Empty{}:
      IO.pure(Unit, Unit{})
    case Foreground{file}:
      close_file((file, [0]))
    case Completed{result}:
      close_result(result)
    case Background{gate, result, ack}:
      do IO<Unit>:
        Unit <- Chan.close(Unit, gate)
        Unit <- IO.join(Unit, ack)
        close_result(result)

def path_chars(path: String) -> Bool:
  match path:
    case SNil{}:
      True{}
    case SCon{h, t}:
      Bool.and(U32.is_ne(Char.to_u32(h), 0), path_chars(t))

def open_command(ok: Bool, path: String) -> Maybe<&2, Command>:
  match ok:
    case True{}:
      Some{OpenFile{path}}
    case False{}:
      None{}

def open_text(+path: String) -> Maybe<&2, Command>:
  match path:
    case SNil{}:
      None{}
    case SCon{h, t}:
      open_command(path_chars(path), path)

def text_command(got: Maybe<&2, Bytes.SplitText>, tag: U32) -> Maybe<&2, Command>:
  match got:
    case Some{Bytes.SplitText{text, []}}:
      match tag:
        case 4:
          Some{Channels{text}}
        case 5:
          open_text(text)
        case 6:
          Some{WriteFile{text}}
        case 7:
          Some{Transfer{text}}
        case other:
          None{}
    case other:
      None{}

def take_command(payload: List<&2, U32>) -> Maybe<&2, Command>:
  match payload:
    case 4 <> rest:
      text_command(Bytes.take_text(64, rest), 4)
    case 5 <> rest:
      text_command(Bytes.take_text(96, rest), 5)
    case 6 <> rest:
      text_command(Bytes.take_text(64, rest), 6)
    case 7 <> rest:
      text_command(Bytes.take_text(64, rest), 7)
    case [8]:
      Some{Release{}}
    case [9]:
      Some{Collect{}}
    case [10]:
      Some{CloseFile{}}
    case other:
      None{}
