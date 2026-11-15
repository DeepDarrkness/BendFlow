import Base
import ./transport.bend as Transport

def contract() -> List<&2, U32>:
  [66, 101, 110, 100, 70, 108, 111, 119, 47, 101, 99, 104, 111, 47, 118, 49]

def bytes_equal(a: List<&2, U32>, b: List<&2, U32>) -> Bool:
  match a b:
    case Nil{} Nil{}:
      True{}
    case x <> xs y <> ys:
      Bool.and(U32.is_eq(x, y), bytes_equal(xs, ys))
    case _ _:
      False{}

def reply(s: Socket, valid: Bool, frame: Transport.Frame, next: Socket -> IO(Unit)) -> IO(Unit):
  match valid:
    case False{}:
      Socket.close(s)
    case True{}:
      Transport.send(s, frame, next)

def dispatch(s: Socket, frame: Maybe<&2, Transport.Frame>, ready: Bool, next: Socket -> IO(Unit)) -> IO(Unit):
  match frame:
    case None{}:
      Socket.close(s)
    case Some{Transport.Frame{+kind, +id, +op, +payload}}:
      match ready:
        case False{}:
          reply(s, Bool.and(Bool.and(U32.is_eq(kind, 1), U32.is_eq(id, 0)),
            Bool.and(U32.is_eq(op, 0), bytes_equal(payload, contract()))),
            Transport.Frame{2, 0, 0, contract()}, next)
        case True{}:
          reply(s, Bool.and(U32.is_eq(kind, 3), Bool.and(U32.is_ne(id, 0), U32.is_eq(op, 65535))),
            Transport.Frame{4, id, op, payload}, next)

def received(got: Socket & Transport.ReadResult, ready: Bool, next: Socket -> IO(Unit)) -> IO(Unit):
  (s, r) = got
  match r:
    case Transport.Bytes{bytes}:
      dispatch(s, Transport.parse(bytes), ready, next)
    case other:
      Socket.close(s)

def connection(fuel: Nat, s: Socket, ready: Bool) -> IO(Unit):
  match fuel:
    case 0n:
      Socket.close(s)
    case 1n+f:
      do IO<Unit>:
        got : Socket & Transport.ReadResult <- Transport.receive(s)
        received(got, ready, s3 => connection(f, s3, True{}))

def accepted_socket(r: Result<&1, &1, U32 & String, Socket>) -> IO(Unit):
  match r:
    case Fail{e}:
      IO.exit(1)
    case Done{s}:
      connection(4294967295n, s, False{})

def accepted(got: Listener & Result<&1, &1, U32 & String, Socket>) -> IO(Unit):
  (l, r) = got
  do IO<Unit>:
    Listener.close(l)
    accepted_socket(r)

def listen(port: Maybe<&2, U32>) -> IO(Unit):
  match port:
    case None{}:
      IO.die(Unit, 1, "usage: echo-worker PORT")
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
      IO.die(Unit, 1, "usage: echo-worker PORT")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    arguments(args)
