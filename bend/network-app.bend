import Base
import ./bytes.bend as Bytes
import ./loop.bend as Loop

type Resource is Type:
  Stream{socket: Socket}
  Datagram{socket: Socket}
  Server{listener: Listener}

type State is Type:
  Nets{next: U32, open: Map<&1, Resource>}

type Command is Data:
  Connect{host: String, port: U32}
  Send{id: U32, bytes: List<&2, U32>}
  Recv{id: U32, max: U32}
  Drop{id: U32}
  Bind{host: String, port: U32}
  SendTo{id: U32, host: String, port: U32, bytes: List<&2, U32>}
  RecvFrom{id: U32, max: U32, ms: U32}
  Listen{host: String, port: U32}
  Accept{id: U32}
  TryAccept{id: U32, ms: U32}
  TryRecv{id: U32, max: U32, ms: U32}
  TrySend{id: U32, bytes: List<&2, U32>, ms: U32}
  TrySendTo{id: U32, host: String, port: U32, bytes: List<&2, U32>, ms: U32}

def initial() -> State:
  Nets{1, Map.new(&1, Resource)}

def restore(next: U32, open: Map<&1, Resource>, id: U32, resource: Resource, reply: List<&2, U32>) -> State & List<&2, U32>:
  (Nets{next, Map.set(&1, Resource, open, Bytes.id_key(id), resource)}, reply)

def advance(+id: U32) -> U32:
  (id + 1 : U32)

def retain(+next: U32, open: Map<&1, Resource>, resource: Resource) -> State & List<&2, U32>:
  restore(advance(next), open, next, resource, 0 <> Bytes.encode_u32(next))

def socket_resource(tag: U32, socket: Socket) -> Resource:
  match tag:
    case 0:
      Stream{socket}
    case other:
      Datagram{socket}

def opened_socket(next: U32, open: Map<&1, Resource>, tag: U32, result: Result<&1, &1, U32 & String, Socket>) -> State & List<&2, U32>:
  match result:
    case Fail{error}:
      (Nets{next, open}, Bytes.encode_error(error))
    case Done{socket}:
      retain(next, open, socket_resource(tag, socket))

def opened_listener(next: U32, open: Map<&1, Resource>, result: Result<&1, &1, U32 & String, Listener>) -> State & List<&2, U32>:
  match result:
    case Fail{error}:
      (Nets{next, open}, Bytes.encode_error(error))
    case Done{listener}:
      retain(next, open, Server{listener})

def open_resource(available: Bool, next: U32, open: Map<&1, Resource>, tag: U32, host: String, port: U32) -> IO(State & List<&2, U32>):
  match available:
    case False{}:
      IO.pure(State & List<&2, U32>, (Nets{next, open}, [11]))
    case True{}:
      match tag:
        case 7:
          do IO<State & List<&2, U32>>:
            result : Result<&1, &1, U32 & String, Listener> <- TCP.listen(host, port)
            return opened_listener(next, open, result)
        case other:
          IO.pure(State & List<&2, U32>, (Nets{next, open}, [255]))

def open_socket(available: Bool, next: U32, open: Map<&1, Resource>, tag: U32, host: String, port: U32) -> IO(State & List<&2, U32>):
  match available:
    case False{}:
      IO.pure(State & List<&2, U32>, (Nets{next, open}, [11]))
    case True{}:
      match tag:
        case 0:
          do IO<State & List<&2, U32>>:
            result : Result<&1, &1, U32 & String, Socket> <- TCP.connect(host, port)
            return opened_socket(next, open, 0, result)
        case 4:
          do IO<State & List<&2, U32>>:
            result : Result<&1, &1, U32 & String, Socket> <- UDP.bind(host, port)
            return opened_socket(next, open, 4, result)
        case other:
          open_resource(True{}, next, open, other, host, port)

def close_resource(resource: Resource) -> IO(Unit):
  match resource:
    case Stream{socket}:
      Socket.close(socket)
    case Datagram{socket}:
      Socket.close(socket)
    case Server{listener}:
      Listener.close(listener)

def send_reply(result: Result<&1, &1, (U32 & String) & List<&2, U32>, Unit>) -> List<&2, U32>:
  match result:
    case Done{u}:
      [0]
    case Fail{((code, message), unsent)}:
      8 <> List.append(&2, U32, Bytes.encode_u32(code), Bytes.encode_len_bytes(unsent))

def send_poll(poll: Poll<&1, &1, Result<&1, &1, (U32 & String) & List<&2, U32>, Unit>, List<&2, U32>>) -> List<&2, U32>:
  match poll:
    case Ready{result}:
      send_reply(result)
    case Wait{unsent}:
      9 <> Bytes.encode_len_bytes(unsent)

def recv_reply(result: Result<&1, &1, U32 & String, Maybe<&1, List<&2, U32>>>) -> List<&2, U32>:
  match result:
    case Fail{error}:
      Bytes.encode_error(error)
    case Done{None{}}:
      [5]
    case Done{Some{bytes}}:
      1 <> Bytes.encode_len_bytes(bytes)

def recv_poll(poll: Poll<&1, &1, Result<&1, &1, U32 & String, Maybe<&1, List<&2, U32>>>, Unit>) -> List<&2, U32>:
  match poll:
    case Ready{result}:
      recv_reply(result)
    case Wait{u}:
      [7]

def dgram_poll(poll: Poll<&1, &1, Result<&1, &1, U32 & String, String & U32 & List<&2, U32>>, Unit>) -> List<&2, U32>:
  match poll:
    case Wait{u}:
      [7]
    case Ready{Fail{error}}:
      Bytes.encode_error(error)
    case Ready{Done{(host, port, bytes)}}:
      6 <> List.append(&2, U32, Bytes.encode_text(host), List.append(&2, U32, Bytes.encode_u32(port), Bytes.encode_len_bytes(bytes)))

def socket_reply(~A: Type, ~encode: A -> List<&2, U32>, next: U32, open: Map<&1, Resource>, id: U32, tag: U32, got: Socket & A) -> State & List<&2, U32>:
  (socket, result) = got
  restore(next, open, id, socket_resource(tag, socket), encode(result))

def stream_op(next: U32, open: Map<&1, Resource>, id: U32, socket: Socket, tag: U32, bytes: List<&2, U32>, max: U32, ms: U32) -> IO(State & List<&2, U32>):
  match tag:
    case 1:
      do IO<State & List<&2, U32>>:
        got : Socket & Result<&1, &1, (U32 & String) & List<&2, U32>, Unit> <- TCP.send_bytes(socket, bytes)
        return socket_reply(~Result<&1, &1, (U32 & String) & List<&2, U32>, Unit>, ~send_reply, next, open, id, 0, got)
    case 11:
      do IO<State & List<&2, U32>>:
        got : Socket & Poll<&1, &1, Result<&1, &1, (U32 & String) & List<&2, U32>, Unit>, List<&2, U32>> <- TCP.try_send_bytes(socket, bytes, ms)
        return socket_reply(~Poll<&1, &1, Result<&1, &1, (U32 & String) & List<&2, U32>, Unit>, List<&2, U32>>, ~send_poll, next, open, id, 0, got)
    case 2:
      do IO<State & List<&2, U32>>:
        got : Socket & Result<&1, &1, U32 & String, Maybe<&1, List<&2, U32>>> <- TCP.recv_bytes(socket, max)
        return socket_reply(~Result<&1, &1, U32 & String, Maybe<&1, List<&2, U32>>>, ~recv_reply, next, open, id, 0, got)
    case 10:
      do IO<State & List<&2, U32>>:
        got : Socket & Poll<&1, &1, Result<&1, &1, U32 & String, Maybe<&1, List<&2, U32>>>, Unit> <- TCP.try_recv_bytes(socket, max, ms)
        return socket_reply(~Poll<&1, &1, Result<&1, &1, U32 & String, Maybe<&1, List<&2, U32>>>, Unit>, ~recv_poll, next, open, id, 0, got)
    case other:
      IO.pure(State & List<&2, U32>, restore(next, open, id, Stream{socket}, [10]))

def datagram_op(next: U32, open: Map<&1, Resource>, id: U32, socket: Socket, tag: U32, host: String, port: U32, bytes: List<&2, U32>, max: U32, ms: U32) -> IO(State & List<&2, U32>):
  match tag:
    case 5:
      do IO<State & List<&2, U32>>:
        got : Socket & Result<&1, &1, (U32 & String) & List<&2, U32>, Unit> <- UDP.send_bytes_to(socket, host, port, bytes)
        return socket_reply(~Result<&1, &1, (U32 & String) & List<&2, U32>, Unit>, ~send_reply, next, open, id, 4, got)
    case 12:
      do IO<State & List<&2, U32>>:
        got : Socket & Poll<&1, &1, Result<&1, &1, (U32 & String) & List<&2, U32>, Unit>, List<&2, U32>> <- UDP.try_send_bytes_to(socket, host, port, bytes, ms)
        return socket_reply(~Poll<&1, &1, Result<&1, &1, (U32 & String) & List<&2, U32>, Unit>, List<&2, U32>>, ~send_poll, next, open, id, 4, got)
    case 6:
      do IO<State & List<&2, U32>>:
        got : Socket & Poll<&1, &1, Result<&1, &1, U32 & String, String & U32 & List<&2, U32>>, Unit> <- UDP.try_recv_bytes_from(socket, max, ms)
        return socket_reply(~Poll<&1, &1, Result<&1, &1, U32 & String, String & U32 & List<&2, U32>>, Unit>, ~dgram_poll, next, open, id, 4, got)
    case other:
      IO.pure(State & List<&2, U32>, restore(next, open, id, Datagram{socket}, [10]))

def accepted(next: U32, open: Map<&1, Resource>, result: Result<&1, &1, U32 & String, Socket>) -> State & List<&2, U32>:
  opened_socket(next, open, 0, result)

def accept_poll(next: U32, open: Map<&1, Resource>, poll: Poll<&1, &1, Result<&1, &1, U32 & String, Socket>, Unit>) -> State & List<&2, U32>:
  match poll:
    case Ready{result}:
      accepted(next, open, result)
    case Wait{u}:
      (Nets{next, open}, [7])

def listener_result(next: U32, open: Map<&1, Resource>, id: U32, got: Listener & Result<&1, &1, U32 & String, Socket>) -> State & List<&2, U32>:
  (listener, result) = got
  accepted(next, Map.set(&1, Resource, open, Bytes.id_key(id), Server{listener}), result)

def listener_poll(next: U32, open: Map<&1, Resource>, id: U32, got: Listener & Poll<&1, &1, Result<&1, &1, U32 & String, Socket>, Unit>) -> State & List<&2, U32>:
  (listener, poll) = got
  accept_poll(next, Map.set(&1, Resource, open, Bytes.id_key(id), Server{listener}), poll)

def listener_op(available: Bool, +next: U32, open: Map<&1, Resource>, id: U32, listener: Listener, tag: U32, ms: U32) -> IO(State & List<&2, U32>):
  match available:
    case False{}:
      IO.pure(State & List<&2, U32>, restore(next, open, id, Server{listener}, [11]))
    case True{}:
      match tag:
        case 8:
          do IO<State & List<&2, U32>>:
            got : Listener & Result<&1, &1, U32 & String, Socket> <- TCP.accept(listener)
            return listener_result(next, open, id, got)
        case 9:
          do IO<State & List<&2, U32>>:
            got : Listener & Poll<&1, &1, Result<&1, &1, U32 & String, Socket>, Unit> <- TCP.try_accept(listener, ms)
            return listener_poll(next, open, id, got)
        case other:
          IO.pure(State & List<&2, U32>, restore(next, open, id, Server{listener}, [10]))

def resource_op(+next: U32, open: Map<&1, Resource>, id: U32, tag: U32, host: String, port: U32, bytes: List<&2, U32>, max: U32, ms: U32, resource: Resource) -> IO(State & List<&2, U32>):
  match tag:
    case 3:
      do IO<State & List<&2, U32>>:
        Unit <- close_resource(resource)
        return (Nets{next, open}, [0])
    case other:
      match resource:
        case Stream{socket}:
          stream_op(next, open, id, socket, other, bytes, max, ms)
        case Datagram{socket}:
          datagram_op(next, open, id, socket, other, host, port, bytes, max, ms)
        case Server{listener}:
          listener_op(U32.is_ne(next, 0), next, open, id, listener, other, ms)

def use_resource(next: U32, id: U32, tag: U32, host: String, port: U32, bytes: List<&2, U32>, max: U32, ms: U32, got: Map<&1, Resource> & Maybe<&1, Resource>) -> IO(State & List<&2, U32>):
  (open, resource) = got
  match resource:
    case None{}:
      IO.pure(State & List<&2, U32>, (Nets{next, open}, [3]))
    case Some{resource}:
      resource_op(next, open, id, tag, host, port, bytes, max, ms, resource)

def step(state: State, command: Command) -> IO(State & List<&2, U32>):
  match state command:
    case Nets{+next, open} Connect{host, port}:
      open_socket(U32.is_ne(next, 0), next, open, 0, host, port)
    case Nets{+next, open} Bind{host, port}:
      open_socket(U32.is_ne(next, 0), next, open, 4, host, port)
    case Nets{+next, open} Listen{host, port}:
      open_socket(U32.is_ne(next, 0), next, open, 7, host, port)
    case Nets{next, open} Send{+id, bytes}:
      use_resource(next, id, 1, "", 0, bytes, 0, 0, Map.pop(&1, Resource, open, Bytes.id_key(id)))
    case Nets{next, open} Recv{+id, max}:
      use_resource(next, id, 2, "", 0, [], max, 0, Map.pop(&1, Resource, open, Bytes.id_key(id)))
    case Nets{next, open} Drop{+id}:
      use_resource(next, id, 3, "", 0, [], 0, 0, Map.pop(&1, Resource, open, Bytes.id_key(id)))
    case Nets{next, open} SendTo{+id, host, port, bytes}:
      use_resource(next, id, 5, host, port, bytes, 0, 0, Map.pop(&1, Resource, open, Bytes.id_key(id)))
    case Nets{next, open} RecvFrom{+id, max, ms}:
      use_resource(next, id, 6, "", 0, [], max, ms, Map.pop(&1, Resource, open, Bytes.id_key(id)))
    case Nets{next, open} Accept{+id}:
      use_resource(next, id, 8, "", 0, [], 0, 0, Map.pop(&1, Resource, open, Bytes.id_key(id)))
    case Nets{next, open} TryAccept{+id, ms}:
      use_resource(next, id, 9, "", 0, [], 0, ms, Map.pop(&1, Resource, open, Bytes.id_key(id)))
    case Nets{next, open} TryRecv{+id, max, ms}:
      use_resource(next, id, 10, "", 0, [], max, ms, Map.pop(&1, Resource, open, Bytes.id_key(id)))
    case Nets{next, open} TrySend{+id, bytes, ms}:
      use_resource(next, id, 11, "", 0, bytes, 0, ms, Map.pop(&1, Resource, open, Bytes.id_key(id)))
    case Nets{next, open} TrySendTo{+id, host, port, bytes, ms}:
      use_resource(next, id, 12, host, port, bytes, 0, ms, Map.pop(&1, Resource, open, Bytes.id_key(id)))

def close_list(resources: List<&1, Resource>) -> IO(Unit):
  match resources:
    case Nil{}:
      IO.pure(Unit, Unit{})
    case resource <> rest:
      do IO<Unit>:
        Unit <- close_resource(resource)
        close_list(rest)

def shutdown(state: State) -> IO(Unit):
  match state:
    case Nets{next, open}:
      close_list(Map.values(&1, Resource, open))

def valid_part(+part: String, got: Maybe<&2, U32>) -> Bool:
  match got:
    case None{}:
      False{}
    case Some{+n}:
      Bool.and(String.eq(part, U32.show(n)), U32.is_le(n, 255))

def valid_host.parts(parts: List<&2, String>) -> Bool:
  match parts:
    case Nil{}:
      True{}
    case +part <> rest:
      Bool.and(valid_part(part, U32.read(part)), valid_host.parts(rest))

def valid_host(+host: String) -> Bool:
  +parts = String.split(host, '.')
  Bool.and(Nat.is_eq(List.length(&2, String, parts), 4n), valid_host.parts(parts))

def finish(ok: Bool, command: Maybe<&2, Command>) -> Maybe<&2, Command>:
  match ok:
    case True{}:
      command
    case False{}:
      None{}

def use_command(tag: U32, id: U32, host: String, port: U32, bytes: List<&2, U32>, max: U32, ms: U32) -> Maybe<&2, Command>:
  match tag:
    case 1:
      Some{Send{id, bytes}}
    case 2:
      Some{Recv{id, max}}
    case 3:
      Some{Drop{id}}
    case 5:
      Some{SendTo{id, host, port, bytes}}
    case 6:
      Some{RecvFrom{id, max, ms}}
    case 8:
      Some{Accept{id}}
    case 9:
      Some{TryAccept{id, ms}}
    case 10:
      Some{TryRecv{id, max, ms}}
    case 11:
      Some{TrySend{id, bytes, ms}}
    case 12:
      Some{TrySendTo{id, host, port, bytes, ms}}
    case other:
      None{}

def open_command(tag: U32, host: String, port: U32) -> Maybe<&2, Command>:
  match tag:
    case 0:
      Some{Connect{host, port}}
    case 4:
      Some{Bind{host, port}}
    case 7:
      Some{Listen{host, port}}
    case other:
      None{}

def decode_use(tag: U32, id: U32, host: String, port: U32, bytes: List<&2, U32>, max: U32, ms: U32, rest: List<&2, U32>) -> Maybe<&2, Command>:
  finish(Bytes.finished(rest), use_command(tag, id, host, port, bytes, max, ms))

def decode_ms(tag: U32, id: U32, host: String, port: U32, bytes: List<&2, U32>, max: U32, got: Maybe<&2, Bytes.SplitU32>) -> Maybe<&2, Command>:
  match got:
    case None{}:
      None{}
    case Some{Bytes.SplitU32{+ms, rest}}:
      finish(Bool.and(U32.is_le(ms, 10000), Bytes.finished(rest)), use_command(tag, id, host, port, bytes, max, ms))

def decode_bytes_rest(tag: U32, id: U32, host: String, port: U32, bytes: List<&2, U32>, rest: List<&2, U32>) -> Maybe<&2, Command>:
  match tag:
    case 11:
      decode_ms(11, id, host, port, bytes, 0, Bytes.take_u32(rest))
    case 12:
      decode_ms(12, id, host, port, bytes, 0, Bytes.take_u32(rest))
    case other:
      decode_use(other, id, host, port, bytes, 0, 0, rest)

def decode_bytes(tag: U32, id: U32, host: String, port: U32, got: Maybe<&2, Bytes.SplitBytes>) -> Maybe<&2, Command>:
  match got:
    case None{}:
      None{}
    case Some{Bytes.SplitBytes{bytes, rest}}:
      decode_bytes_rest(tag, id, host, port, bytes, rest)

def decode_port(ok: Bool, tag: U32, id: U32, host: String, +port: U32, rest: List<&2, U32>) -> Maybe<&2, Command>:
  match ok:
    case False{}:
      None{}
    case True{}:
      match tag:
        case 5:
          decode_bytes(5, id, host, port, Bytes.take_len_bytes(96, rest))
        case 12:
          decode_bytes(12, id, host, port, Bytes.take_len_bytes(96, rest))
        case other:
          finish(Bytes.finished(rest), open_command(other, host, port))

def decode_host_port(+tag: U32, id: U32, +host: String, got: Maybe<&2, Bytes.SplitU32>) -> Maybe<&2, Command>:
  match got:
    case None{}:
      None{}
    case Some{Bytes.SplitU32{+port, rest}}:
      decode_port(Bool.and(valid_host(host), Bool.and(U32.is_le(port, 65535), Bool.or(Bool.or(U32.is_eq(tag, 4), U32.is_eq(tag, 7)), U32.is_ge(port, 1)))), tag, id, host, port, rest)

def decode_host(tag: U32, id: U32, got: Maybe<&2, Bytes.SplitText>) -> Maybe<&2, Command>:
  match got:
    case None{}:
      None{}
    case Some{Bytes.SplitText{host, rest}}:
      decode_host_port(tag, id, host, Bytes.take_u32(rest))

def decode_max_ok(ok: Bool, tag: U32, id: U32, max: U32, rest: List<&2, U32>) -> Maybe<&2, Command>:
  match ok:
    case False{}:
      None{}
    case True{}:
      match tag:
        case 2:
          decode_use(2, id, "", 0, [], max, 0, rest)
        case other:
          decode_ms(other, id, "", 0, [], max, Bytes.take_u32(rest))

def decode_max(tag: U32, id: U32, got: Maybe<&2, Bytes.SplitU32>) -> Maybe<&2, Command>:
  match got:
    case None{}:
      None{}
    case Some{Bytes.SplitU32{+max, rest}}:
      decode_max_ok(Bool.and(U32.is_ge(max, 1), U32.is_le(max, 192)), tag, id, max, rest)

def decode_id_ok(ok: Bool, tag: U32, id: U32, rest: List<&2, U32>) -> Maybe<&2, Command>:
  match ok:
    case False{}:
      None{}
    case True{}:
      match tag:
        case 1:
          decode_bytes(1, id, "", 0, Bytes.take_len_bytes(192, rest))
        case 11:
          decode_bytes(11, id, "", 0, Bytes.take_len_bytes(192, rest))
        case 2:
          decode_max(2, id, Bytes.take_u32(rest))
        case 6:
          decode_max(6, id, Bytes.take_u32(rest))
        case 10:
          decode_max(10, id, Bytes.take_u32(rest))
        case 5:
          decode_host(5, id, Bytes.take_text(64, rest))
        case 12:
          decode_host(12, id, Bytes.take_text(64, rest))
        case 9:
          decode_ms(9, id, "", 0, [], 0, Bytes.take_u32(rest))
        case other:
          decode_use(other, id, "", 0, [], 0, 0, rest)

def decode_id(tag: U32, got: Maybe<&2, Bytes.SplitU32>) -> Maybe<&2, Command>:
  match got:
    case None{}:
      None{}
    case Some{Bytes.SplitU32{+id, rest}}:
      decode_id_ok(U32.is_ge(id, 1), tag, id, rest)

def finish_tag(ok: Bool, tag: U32, rest: List<&2, U32>) -> Maybe<&2, Command>:
  match ok:
    case False{}:
      None{}
    case True{}:
      decode_id(tag, Bytes.take_u32(rest))

def take_command(payload: List<&2, U32>) -> Maybe<&2, Command>:
  match payload:
    case 0 <> rest:
      decode_host(0, 0, Bytes.take_text(64, rest))
    case 4 <> rest:
      decode_host(4, 0, Bytes.take_text(64, rest))
    case 7 <> rest:
      decode_host(7, 0, Bytes.take_text(64, rest))
    case +tag <> rest:
      finish_tag(U32.is_le(tag, 12), tag, rest)
    case Nil{}:
      None{}
