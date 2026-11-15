import Base
import ./bytes.bend as Bytes
import ./loop.bend as Loop

type State is Type:
  Nets{next: U32, open: Map<&1, Socket>}

type Command is Data:
  Connect{host: String, port: U32}
  Send{id: U32, bytes: List<&2, U32>}
  Recv{id: U32, max: U32}
  Drop{id: U32}
  Bind{host: String, port: U32}
  SendTo{id: U32, host: String, port: U32, bytes: List<&2, U32>}
  RecvFrom{id: U32, max: U32, ms: U32}

def initial() -> State:
  Nets{1, Map.new(&1, Socket)}

def encode_fail(error: U32 & String) -> List<&2, U32>:
  (code, message) = error
  2 <> List.append(&2, U32, Bytes.encode_u32(code), Bytes.encode_text(message))

def encode_id(id: U32) -> List<&2, U32>:
  0 <> Bytes.encode_u32(id)

def encode_bytes(bytes: List<&2, U32>) -> List<&2, U32>:
  1 <> Bytes.encode_len_bytes(bytes)

def missing() -> List<&2, U32>:
  [3]

def opened_ok(+id: U32, next: U32, open: Map<&1, Socket>, sock: Socket) -> State & List<&2, U32>:
  (Nets{next, Map.set(&1, Socket, open, Bytes.id_key(id), sock)}, encode_id(id))

def opened(+next: U32, open: Map<&1, Socket>, result: Result<&1, &1, U32 & String, Socket>) -> State & List<&2, U32>:
  match result:
    case Fail{error}:
      (Nets{next, open}, encode_fail(error))
    case Done{sock}:
      +id = next
      opened_ok(id, (id + 1 : U32), open, sock)

def send_fail(+next: U32, +id: U32, open: Map<&1, Socket>, sock: Socket, error: (U32 & String) & List<&2, U32>) -> State & List<&2, U32>:
  (pair, unsent) = error
  (Nets{next, Map.set(&1, Socket, open, Bytes.id_key(id), sock)}, encode_fail(pair))

def after_send(+next: U32, +id: U32, open: Map<&1, Socket>, got: Socket & Result<&1, &1, (U32 & String) & List<&2, U32>, Unit>) -> State & List<&2, U32>:
  (sock, result) = got
  match result:
    case Fail{error}:
      send_fail(next, id, open, sock, error)
    case Done{u}:
      (Nets{next, Map.set(&1, Socket, open, Bytes.id_key(id), sock)}, Loop.ok())

def recv_data(+next: U32, +id: U32, open: Map<&1, Socket>, sock: Socket, got: Maybe<&1, List<&2, U32>>) -> State & List<&2, U32>:
  match got:
    case None{}:
      (Nets{next, Map.set(&1, Socket, open, Bytes.id_key(id), sock)}, [5])
    case Some{bytes}:
      (Nets{next, Map.set(&1, Socket, open, Bytes.id_key(id), sock)}, encode_bytes(bytes))

def after_recv(+next: U32, +id: U32, open: Map<&1, Socket>, got: Socket & Result<&1, &1, U32 & String, Maybe<&1, List<&2, U32>>>) -> State & List<&2, U32>:
  (sock, result) = got
  match result:
    case Fail{error}:
      (Nets{next, Map.set(&1, Socket, open, Bytes.id_key(id), sock)}, encode_fail(error))
    case Done{data}:
      recv_data(next, id, open, sock, data)

def with_send(+next: U32, +id: U32, bytes: List<&2, U32>, got: Map<&1, Socket> & Maybe<&1, Socket>) -> IO(State & List<&2, U32>):
  (open, sock) = got
  match sock:
    case None{}:
      IO.pure(State & List<&2, U32>, (Nets{next, open}, missing()))
    case Some{h}:
      do IO<State & List<&2, U32>>:
        result : Socket & Result<&1, &1, (U32 & String) & List<&2, U32>, Unit> <- TCP.send_bytes(h, bytes)
        return after_send(next, id, open, result)

def with_recv(+next: U32, +id: U32, max: U32, got: Map<&1, Socket> & Maybe<&1, Socket>) -> IO(State & List<&2, U32>):
  (open, sock) = got
  match sock:
    case None{}:
      IO.pure(State & List<&2, U32>, (Nets{next, open}, missing()))
    case Some{h}:
      do IO<State & List<&2, U32>>:
        result : Socket & Result<&1, &1, U32 & String, Maybe<&1, List<&2, U32>>> <- TCP.recv_bytes(h, max)
        return after_recv(next, id, open, result)

def with_drop(+next: U32, got: Map<&1, Socket> & Maybe<&1, Socket>) -> IO(State & List<&2, U32>):
  (open, sock) = got
  match sock:
    case None{}:
      IO.pure(State & List<&2, U32>, (Nets{next, open}, missing()))
    case Some{h}:
      do IO<State & List<&2, U32>>:
        Unit <- Socket.close(h)
        return (Nets{next, open}, Loop.ok())

def send_to_fail(+next: U32, +id: U32, open: Map<&1, Socket>, sock: Socket, error: (U32 & String) & List<&2, U32>) -> State & List<&2, U32>:
  (pair, unsent) = error
  (Nets{next, Map.set(&1, Socket, open, Bytes.id_key(id), sock)}, encode_fail(pair))

def after_send_to(+next: U32, +id: U32, open: Map<&1, Socket>, got: Socket & Result<&1, &1, (U32 & String) & List<&2, U32>, Unit>) -> State & List<&2, U32>:
  (sock, result) = got
  match result:
    case Fail{error}:
      send_to_fail(next, id, open, sock, error)
    case Done{u}:
      (Nets{next, Map.set(&1, Socket, open, Bytes.id_key(id), sock)}, Loop.ok())

def dgram_reply(+next: U32, +id: U32, open: Map<&1, Socket>, sock: Socket, got: String & U32 & List<&2, U32>) -> State & List<&2, U32>:
  (host, port, bytes) = got
  (Nets{next, Map.set(&1, Socket, open, Bytes.id_key(id), sock)}, 6 <> List.append(&2, U32, Bytes.encode_text(host), List.append(&2, U32, Bytes.encode_u32(port), Bytes.encode_len_bytes(bytes))))

def after_recv_from_ready(+next: U32, +id: U32, open: Map<&1, Socket>, sock: Socket, result: Result<&1, &1, U32 & String, String & U32 & List<&2, U32>>) -> State & List<&2, U32>:
  match result:
    case Fail{error}:
      (Nets{next, Map.set(&1, Socket, open, Bytes.id_key(id), sock)}, encode_fail(error))
    case Done{got}:
      dgram_reply(next, id, open, sock, got)

def after_recv_from(+next: U32, +id: U32, open: Map<&1, Socket>, got: Socket & Poll<&1, &1, Result<&1, &1, U32 & String, String & U32 & List<&2, U32>>, Unit>) -> State & List<&2, U32>:
  (sock, poll) = got
  match poll:
    case Ready{value}:
      after_recv_from_ready(next, id, open, sock, value)
    case Wait{u}:
      (Nets{next, Map.set(&1, Socket, open, Bytes.id_key(id), sock)}, [7])

def with_send_to(+next: U32, +id: U32, host: String, port: U32, bytes: List<&2, U32>, got: Map<&1, Socket> & Maybe<&1, Socket>) -> IO(State & List<&2, U32>):
  (open, sock) = got
  match sock:
    case None{}:
      IO.pure(State & List<&2, U32>, (Nets{next, open}, missing()))
    case Some{h}:
      do IO<State & List<&2, U32>>:
        result : Socket & Result<&1, &1, (U32 & String) & List<&2, U32>, Unit> <- UDP.send_bytes_to(h, host, port, bytes)
        return after_send_to(next, id, open, result)

def with_recv_from(+next: U32, +id: U32, max: U32, ms: U32, got: Map<&1, Socket> & Maybe<&1, Socket>) -> IO(State & List<&2, U32>):
  (open, sock) = got
  match sock:
    case None{}:
      IO.pure(State & List<&2, U32>, (Nets{next, open}, missing()))
    case Some{h}:
      do IO<State & List<&2, U32>>:
        result : Socket & Poll<&1, &1, Result<&1, &1, U32 & String, String & U32 & List<&2, U32>>, Unit> <- UDP.try_recv_bytes_from(h, max, ms)
        return after_recv_from(next, id, open, result)

def step(state: State, command: Command) -> IO(State & List<&2, U32>):
  match state command:
    case Nets{+next, open} Connect{host, port}:
      do IO<State & List<&2, U32>>:
        result : Result<&1, &1, U32 & String, Socket> <- TCP.connect(host, port)
        return opened(next, open, result)
    case Nets{+next, open} Send{+id, bytes}:
      with_send(next, id, bytes, Map.pop(&1, Socket, open, Bytes.id_key(id)))
    case Nets{+next, open} Recv{+id, max}:
      with_recv(next, id, max, Map.pop(&1, Socket, open, Bytes.id_key(id)))
    case Nets{+next, open} Drop{id}:
      with_drop(next, Map.pop(&1, Socket, open, Bytes.id_key(id)))
    case Nets{+next, open} Bind{host, port}:
      do IO<State & List<&2, U32>>:
        result : Result<&1, &1, U32 & String, Socket> <- UDP.bind(host, port)
        return opened(next, open, result)
    case Nets{+next, open} SendTo{+id, host, port, bytes}:
      with_send_to(next, id, host, port, bytes, Map.pop(&1, Socket, open, Bytes.id_key(id)))
    case Nets{+next, open} RecvFrom{+id, max, ms}:
      with_recv_from(next, id, max, ms, Map.pop(&1, Socket, open, Bytes.id_key(id)))

def close_list(socks: List<&1, Socket>) -> IO(Unit):
  match socks:
    case Nil{}:
      IO.pure(Unit, Unit{})
    case h <> t:
      do IO<Unit>:
        Unit <- Socket.close(h)
        close_list(t)

def shutdown(state: State) -> IO(Unit):
  match state:
    case Nets{next, open}:
      close_list(Map.values(&1, Socket, open))

def finish_connect(ok: Bool, host: String, port: U32) -> Maybe<&2, Command>:
  match ok:
    case True{}:
      Some{Connect{host, port}}
    case False{}:
      None{}

def take_connect_port(host: String, got: Maybe<&2, Bytes.SplitU32>) -> Maybe<&2, Command>:
  match got:
    case None{}:
      None{}
    case Some{Bytes.SplitU32{port, more}}:
      finish_connect(Bytes.finished(more), host, port)

def take_connect(got: Maybe<&2, Bytes.SplitText>) -> Maybe<&2, Command>:
  match got:
    case None{}:
      None{}
    case Some{Bytes.SplitText{host, rest}}:
      take_connect_port(host, Bytes.take_u32(rest))

def finish_send(ok: Bool, id: U32, bytes: List<&2, U32>) -> Maybe<&2, Command>:
  match ok:
    case True{}:
      Some{Send{id, bytes}}
    case False{}:
      None{}

def take_send_bytes(id: U32, got: Maybe<&2, Bytes.SplitBytes>) -> Maybe<&2, Command>:
  match got:
    case None{}:
      None{}
    case Some{Bytes.SplitBytes{bytes, more}}:
      finish_send(Bytes.finished(more), id, bytes)

def take_send(got: Maybe<&2, Bytes.SplitU32>) -> Maybe<&2, Command>:
  match got:
    case None{}:
      None{}
    case Some{Bytes.SplitU32{id, rest}}:
      take_send_bytes(id, Bytes.take_len_bytes(192, rest))

def finish_recv(ok: Bool, id: U32, max: U32) -> Maybe<&2, Command>:
  match ok:
    case True{}:
      Some{Recv{id, max}}
    case False{}:
      None{}

def take_recv_max(id: U32, got: Maybe<&2, Bytes.SplitU32>) -> Maybe<&2, Command>:
  match got:
    case None{}:
      None{}
    case Some{Bytes.SplitU32{max, more}}:
      finish_recv(Bytes.finished(more), id, max)

def take_recv(got: Maybe<&2, Bytes.SplitU32>) -> Maybe<&2, Command>:
  match got:
    case None{}:
      None{}
    case Some{Bytes.SplitU32{id, rest}}:
      take_recv_max(id, Bytes.take_u32(rest))

def finish_drop(ok: Bool, id: U32) -> Maybe<&2, Command>:
  match ok:
    case True{}:
      Some{Drop{id}}
    case False{}:
      None{}

def take_drop(got: Maybe<&2, Bytes.SplitU32>) -> Maybe<&2, Command>:
  match got:
    case None{}:
      None{}
    case Some{Bytes.SplitU32{id, more}}:
      finish_drop(Bytes.finished(more), id)

def finish_bind(ok: Bool, host: String, port: U32) -> Maybe<&2, Command>:
  match ok:
    case True{}:
      Some{Bind{host, port}}
    case False{}:
      None{}

def take_bind_port(host: String, got: Maybe<&2, Bytes.SplitU32>) -> Maybe<&2, Command>:
  match got:
    case None{}:
      None{}
    case Some{Bytes.SplitU32{port, more}}:
      finish_bind(Bytes.finished(more), host, port)

def take_bind(got: Maybe<&2, Bytes.SplitText>) -> Maybe<&2, Command>:
  match got:
    case None{}:
      None{}
    case Some{Bytes.SplitText{host, rest}}:
      take_bind_port(host, Bytes.take_u32(rest))

def finish_send_to(ok: Bool, id: U32, host: String, port: U32, bytes: List<&2, U32>) -> Maybe<&2, Command>:
  match ok:
    case True{}:
      Some{SendTo{id, host, port, bytes}}
    case False{}:
      None{}

def take_send_to_bytes(id: U32, host: String, port: U32, got: Maybe<&2, Bytes.SplitBytes>) -> Maybe<&2, Command>:
  match got:
    case None{}:
      None{}
    case Some{Bytes.SplitBytes{bytes, more}}:
      finish_send_to(Bytes.finished(more), id, host, port, bytes)

def take_send_to_port(id: U32, host: String, got: Maybe<&2, Bytes.SplitU32>) -> Maybe<&2, Command>:
  match got:
    case None{}:
      None{}
    case Some{Bytes.SplitU32{port, rest}}:
      take_send_to_bytes(id, host, port, Bytes.take_len_bytes(96, rest))

def take_send_to_host(id: U32, got: Maybe<&2, Bytes.SplitText>) -> Maybe<&2, Command>:
  match got:
    case None{}:
      None{}
    case Some{Bytes.SplitText{host, rest}}:
      take_send_to_port(id, host, Bytes.take_u32(rest))

def take_send_to(got: Maybe<&2, Bytes.SplitU32>) -> Maybe<&2, Command>:
  match got:
    case None{}:
      None{}
    case Some{Bytes.SplitU32{id, rest}}:
      take_send_to_host(id, Bytes.take_text(64, rest))

def finish_recv_from(ok: Bool, id: U32, max: U32, ms: U32) -> Maybe<&2, Command>:
  match ok:
    case True{}:
      Some{RecvFrom{id, max, ms}}
    case False{}:
      None{}

def take_recv_from_ms(id: U32, max: U32, got: Maybe<&2, Bytes.SplitU32>) -> Maybe<&2, Command>:
  match got:
    case None{}:
      None{}
    case Some{Bytes.SplitU32{ms, more}}:
      finish_recv_from(Bytes.finished(more), id, max, ms)

def take_recv_from_max(id: U32, got: Maybe<&2, Bytes.SplitU32>) -> Maybe<&2, Command>:
  match got:
    case None{}:
      None{}
    case Some{Bytes.SplitU32{max, rest}}:
      take_recv_from_ms(id, max, Bytes.take_u32(rest))

def take_recv_from(got: Maybe<&2, Bytes.SplitU32>) -> Maybe<&2, Command>:
  match got:
    case None{}:
      None{}
    case Some{Bytes.SplitU32{id, rest}}:
      take_recv_from_max(id, Bytes.take_u32(rest))

def take_command(payload: List<&2, U32>) -> Maybe<&2, Command>:
  match payload:
    case 0 <> rest:
      take_connect(Bytes.take_text(64, rest))
    case 1 <> rest:
      take_send(Bytes.take_u32(rest))
    case 2 <> rest:
      take_recv(Bytes.take_u32(rest))
    case 3 <> rest:
      take_drop(Bytes.take_u32(rest))
    case 4 <> rest:
      take_bind(Bytes.take_text(64, rest))
    case 5 <> rest:
      take_send_to(Bytes.take_u32(rest))
    case 6 <> rest:
      take_recv_from(Bytes.take_u32(rest))
    case other:
      None{}
