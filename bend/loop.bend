import Base
import ./transport.bend as Transport

def invalid() -> List<&2, U32>:
  [255]

def ok() -> List<&2, U32>:
  [0]

def known_op(+op: U32) -> Bool:
  Bool.or(U32.is_eq(op, 1), Bool.or(U32.is_eq(op, 2), U32.is_eq(op, 3)))

def die(~S: Type, ~shutdown: S -> IO(Unit), s: Socket, state: S) -> IO(Unit):
  do IO<Unit>:
    Unit <- shutdown(state)
    Socket.close(s)

def responded(~S: Type, s: Socket, +id: U32, +op: U32, result: S & List<&2, U32>, next: Socket -> S -> IO(Unit)) -> IO(Unit):
  (state, payload) = result
  Transport.send(s, Transport.Frame{4, id, op, payload}, s2 => next(s2, state))

def execute(~S: Type, ~handle: S -> U32 -> List<&2, U32> -> IO(S & List<&2, U32>), s: Socket, state: S, +id: U32, +op: U32, payload: List<&2, U32>, next: Socket -> S -> IO(Unit)) -> IO(Unit):
  do IO<Unit>:
    result : S & List<&2, U32> <- handle(state, op, payload)
    responded(~S, s, id, op, result, next)

def checked(~S: Type, ~handle: S -> U32 -> List<&2, U32> -> IO(S & List<&2, U32>), ~shutdown: S -> IO(Unit), valid: Bool, s: Socket, state: S, id: U32, op: U32, payload: List<&2, U32>, next: Socket -> S -> IO(Unit)) -> IO(Unit):
  match valid:
    case False{}:
      die(~S, ~shutdown, s, state)
    case True{}:
      execute(~S, ~handle, s, state, id, op, payload, next)

def handshake(~S: Type, ~shutdown: S -> IO(Unit), ~contract: Unit -> List<&2, U32>, valid: Bool, s: Socket, state: S, next: Socket -> S -> IO(Unit)) -> IO(Unit):
  match valid:
    case False{}:
      die(~S, ~shutdown, s, state)
    case True{}:
      Transport.send(s, Transport.Frame{2, 0, 0, contract(Unit{})}, s2 => next(s2, state))

def dispatch(~S: Type, ~handle: S -> U32 -> List<&2, U32> -> IO(S & List<&2, U32>), ~shutdown: S -> IO(Unit), ~contract: Unit -> List<&2, U32>, s: Socket, frame: Maybe<&2, Transport.Frame>, ready: Bool, state: S, next: Socket -> S -> IO(Unit)) -> IO(Unit):
  match frame:
    case None{}:
      die(~S, ~shutdown, s, state)
    case Some{Transport.Frame{+kind, +id, +op, payload}}:
      match ready:
        case False{}:
          handshake(~S, ~shutdown, ~contract, Bool.and(Bool.and(U32.is_eq(kind, 1), U32.is_eq(id, 0)), Bool.and(U32.is_eq(op, 0), Transport.bytes_equal(payload, contract(Unit{})))), s, state, next)
        case True{}:
          checked(~S, ~handle, ~shutdown, Bool.and(U32.is_eq(kind, 3), Bool.and(U32.is_ne(id, 0), known_op(op))), s, state, id, op, payload, next)

def received(~S: Type, ~handle: S -> U32 -> List<&2, U32> -> IO(S & List<&2, U32>), ~shutdown: S -> IO(Unit), ~contract: Unit -> List<&2, U32>, got: Socket & Transport.ReadResult, state: S, ready: Bool, next: Socket -> S -> IO(Unit)) -> IO(Unit):
  (s, r) = got
  match r:
    case Transport.Bytes{bytes}:
      dispatch(~S, ~handle, ~shutdown, ~contract, s, Transport.parse(bytes), ready, state, next)
    case other:
      die(~S, ~shutdown, s, state)

def connection(~S: Type, ~handle: S -> U32 -> List<&2, U32> -> IO(S & List<&2, U32>), ~shutdown: S -> IO(Unit), ~contract: Unit -> List<&2, U32>, fuel: Nat, s: Socket, state: S, ready: Bool) -> IO(Unit):
  match fuel:
    case 0n:
      die(~S, ~shutdown, s, state)
    case 1n+f:
      do IO<Unit>:
        got : Socket & Transport.ReadResult <- Transport.receive(s)
        received(~S, ~handle, ~shutdown, ~contract, got, state, ready, s2 => state2 => connection(~S, ~handle, ~shutdown, ~contract, f, s2, state2, True{}))

def accepted_socket(~S: Type, ~handle: S -> U32 -> List<&2, U32> -> IO(S & List<&2, U32>), ~shutdown: S -> IO(Unit), ~contract: Unit -> List<&2, U32>, initial: S, r: Result<&1, &1, U32 & String, Socket>) -> IO(Unit):
  match r:
    case Fail{e}:
      IO.exit(1)
    case Done{s}:
      connection(~S, ~handle, ~shutdown, ~contract, 4294967295n, s, initial, False{})

def accepted(~S: Type, ~handle: S -> U32 -> List<&2, U32> -> IO(S & List<&2, U32>), ~shutdown: S -> IO(Unit), ~contract: Unit -> List<&2, U32>, initial: S, got: Listener & Result<&1, &1, U32 & String, Socket>) -> IO(Unit):
  (l, r) = got
  do IO<Unit>:
    Listener.close(l)
    accepted_socket(~S, ~handle, ~shutdown, ~contract, initial, r)

def listen(~S: Type, ~handle: S -> U32 -> List<&2, U32> -> IO(S & List<&2, U32>), ~shutdown: S -> IO(Unit), ~contract: Unit -> List<&2, U32>, ~usage: String, initial: S, port: Maybe<&2, U32>) -> IO(Unit):
  match port:
    case None{}:
      IO.die(Unit, 1, usage)
    case Some{p}:
      do IO<Unit>:
        l : Listener <- IO.try(Listener, TCP.listen("127.0.0.1", p))
        got : Listener & Result<&1, &1, U32 & String, Socket> <- TCP.accept(l)
        accepted(~S, ~handle, ~shutdown, ~contract, initial, got)

def arguments(~S: Type, ~handle: S -> U32 -> List<&2, U32> -> IO(S & List<&2, U32>), ~shutdown: S -> IO(Unit), ~contract: Unit -> List<&2, U32>, ~usage: String, initial: S, args: List<String>) -> IO(Unit):
  match args:
    case [program, port]:
      listen(~S, ~handle, ~shutdown, ~contract, ~usage, initial, U32.read(port))
    case other:
      IO.die(Unit, 1, usage)

def run(~S: Type, ~handle: S -> U32 -> List<&2, U32> -> IO(S & List<&2, U32>), ~shutdown: S -> IO(Unit), ~contract: Unit -> List<&2, U32>, ~usage: String, initial: S) -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    arguments(~S, ~handle, ~shutdown, ~contract, ~usage, initial, args)
