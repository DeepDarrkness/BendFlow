import Base
import ./session.bend as Session
import ./transport.bend as Transport

def contract() -> List<&2, U32>:
  [66, 101, 110, 100, 70, 108, 111, 119, 47, 115, 101, 115, 115, 105, 111, 110, 47, 118, 49]

def operation() -> U32:
  1

def decode_command(payload: List<&2, U32>) -> Maybe<&2, Session.Command>:
  match payload:
    case 0 <> a <> b <> c <> d <> Nil{}:
      Some{Session.Add{Transport.from_be(a, b, c, d)}}
    case [1]:
      Some{Session.Read{}}
    case [2]:
      Some{Session.Reset{}}
    case other:
      None{}

def encode_snapshot(tag: U32, snapshot: Session.Snapshot) -> List<&2, U32>:
  match snapshot:
    case Session.Snapshot{total, count}:
      tag <> List.append(&2, U32, Transport.u32be(total), Transport.u32be(count))

def encode_reply(reply: Session.Reply) -> List<&2, U32>:
  match reply:
    case Session.Value{value}:
      encode_snapshot(0, value)
    case Session.Overflow{value}:
      encode_snapshot(1, value)

def responded(s: Socket, id: U32, result: Session.State & Session.Reply, next: Socket -> Session.State -> IO(Unit)) -> IO(Unit):
  (state, reply) = result
  Transport.send(s, Transport.Frame{4, id, operation(), encode_reply(reply)}, s2 => next(s2, state))

def execute(s: Socket, state: Session.State, command: Maybe<&2, Session.Command>, id: U32, next: Socket -> Session.State -> IO(Unit)) -> IO(Unit):
  match command:
    case None{}:
      Transport.send(s, Transport.Frame{4, id, operation(), [2]}, s2 => next(s2, state))
    case Some{cmd}:
      responded(s, id, Session.step((state, cmd)), next)

def checked_request(valid: Bool, s: Socket, state: Session.State, id: U32, payload: List<&2, U32>, next: Socket -> Session.State -> IO(Unit)) -> IO(Unit):
  match valid:
    case False{}:
      Socket.close(s)
    case True{}:
      execute(s, state, decode_command(payload), id, next)

def handshake(valid: Bool, s: Socket, state: Session.State, next: Socket -> Session.State -> IO(Unit)) -> IO(Unit):
  match valid:
    case False{}:
      Socket.close(s)
    case True{}:
      Transport.send(s, Transport.Frame{2, 0, 0, contract()}, s2 => next(s2, state))

def dispatch(s: Socket, frame: Maybe<&2, Transport.Frame>, ready: Bool, state: Session.State, next: Socket -> Session.State -> IO(Unit)) -> IO(Unit):
  match frame:
    case None{}:
      Socket.close(s)
    case Some{Transport.Frame{+kind, +id, +op, payload}}:
      match ready:
        case False{}:
          handshake(Bool.and(Bool.and(U32.is_eq(kind, 1), U32.is_eq(id, 0)),
            Bool.and(U32.is_eq(op, 0), Transport.bytes_equal(payload, contract()))), s, state, next)
        case True{}:
          checked_request(Bool.and(U32.is_eq(kind, 3), Bool.and(U32.is_ne(id, 0), U32.is_eq(op, operation()))),
            s, state, id, payload, next)

def received(got: Socket & Transport.ReadResult, state: Session.State, ready: Bool, next: Socket -> Session.State -> IO(Unit)) -> IO(Unit):
  (s, r) = got
  match r:
    case Transport.Bytes{bytes}:
      dispatch(s, Transport.parse(bytes), ready, state, next)
    case other:
      Socket.close(s)

def connection(fuel: Nat, s: Socket, state: Session.State, ready: Bool) -> IO(Unit):
  match fuel:
    case 0n:
      Socket.close(s)
    case 1n+f:
      do IO<Unit>:
        got : Socket & Transport.ReadResult <- Transport.receive(s)
        received(got, state, ready, s2 => state2 => connection(f, s2, state2, True{}))

def accepted_socket(r: Result<&1, &1, U32 & String, Socket>) -> IO(Unit):
  match r:
    case Fail{e}:
      IO.exit(1)
    case Done{s}:
      connection(4294967295n, s, Session.initial(), False{})

def accepted(got: Listener & Result<&1, &1, U32 & String, Socket>) -> IO(Unit):
  (l, r) = got
  do IO<Unit>:
    Listener.close(l)
    accepted_socket(r)

def listen(port: Maybe<&2, U32>) -> IO(Unit):
  match port:
    case None{}:
      IO.die(Unit, 1, "usage: session-worker PORT")
    case Some{p}:
      do IO<Unit>:
        l : Listener <- IO.try(Listener, TCP.listen("127.0.0.1", p))
        got : Listener & Result<&1, &1, U32 & String, Socket> <- TCP.accept(l)
        accepted(got)

def arguments(args: List<String>) -> IO(Unit):
  match args:
    case [program, port]:
      listen(U32.read(port))
    case other:
      IO.die(Unit, 1, "usage: session-worker PORT")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    arguments(args)
