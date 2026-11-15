import Base

type ReadResult is Data:
  Bytes{data: List<&2, U32>}
  End{}
  Truncated{}
  ReadError{}

type Frame is Data:
  Frame{kind: U32, id: U32, operation: U32, payload: List<&2, U32>}

def bytes_equal(a: List<&2, U32>, b: List<&2, U32>) -> Bool:
  match a b:
    case Nil{} Nil{}:
      True{}
    case x <> xs y <> ys:
      Bool.and(U32.is_eq(x, y), bytes_equal(xs, ys))
    case _ _:
      False{}

def u32be(+n: U32) -> List<&2, U32>:
  [(n >> 24n : U32), ((n >> 16n : U32) .&. 255 : U32), ((n >> 8n : U32) .&. 255 : U32), (n .&. 255 : U32)]

def from_be(a: U32, b: U32, c: U32, d: U32) -> U32:
  (((a << 24n : U32) .|. (b << 16n : U32) : U32) .|. ((c << 8n : U32) .|. d : U32) : U32)

def reverse_append(xs: List<&2, U32>, acc: List<&2, U32>) -> List<&2, U32>:
  match xs:
    case Nil{}:
      acc
    case h <> t:
      reverse_append(t, h <> acc)

def eof(acc: List<&2, U32>) -> ReadResult:
  match acc:
    case Nil{}:
      End{}
    case h <> t:
      Truncated{}

def read_chunk(got: Socket & Result<&1, &1, U32 & String, Maybe<&1, List<&2, U32>>>, acc: List<&2, U32>, next: Socket -> List<&2, U32> -> List<&2, U32> -> IO(Socket & ReadResult)) -> IO(Socket & ReadResult):
  (s, r) = got
  match r:
    case Fail{e}:
      IO.pure(Socket & ReadResult, (s, ReadError{}))
    case Done{None{}}:
      IO.pure(Socket & ReadResult, (s, eof(acc)))
    case Done{Some{Nil{}}}:
      IO.pure(Socket & ReadResult, (s, ReadError{}))
    case Done{Some{h <> t}}:
      next(s, h <> t, acc)

def read_choice(s: Socket, acc: List<&2, U32>, remaining: U32, complete: Bool, next: Socket -> U32 -> List<&2, U32> -> IO(Socket & ReadResult)) -> IO(Socket & ReadResult):
  match complete:
    case True{}:
      IO.pure(Socket & ReadResult, (s, Bytes{List.reverse(&2, U32, acc)}))
    case False{}:
      next(s, remaining, acc)

def read_exact(fuel: Nat, s: Socket, +remaining: U32, acc: List<&2, U32>) -> IO(Socket & ReadResult):
  match fuel:
    case 0n:
      IO.pure(Socket & ReadResult, (s, ReadError{}))
    case 1n+f:
      do IO<Socket & ReadResult>:
        got : Socket & Result<&1, &1, U32 & String, Maybe<&1, List<&2, U32>>> <- TCP.recv_bytes(s, remaining)
        read_chunk(got, acc, s3 => +chunk => acc2 =>
          read_choice(s3, reverse_append(chunk, acc2), (remaining - U32.from_nat(List.length(&2, U32, chunk)) : U32),
            U32.is_eq(U32.from_nat(List.length(&2, U32, chunk)), remaining),
            s4 => n => acc3 => read_exact(f, s4, n, acc3)))

def body_result(r: ReadResult) -> ReadResult:
  match r:
    case End{}:
      Truncated{}
    case other:
      other

def body_received(got: Socket & ReadResult) -> IO(Socket & ReadResult):
  (s, r) = got
  IO.pure(Socket & ReadResult, (s, body_result(r)))

def read_body(s: Socket, valid: Bool, n: U32) -> IO(Socket & ReadResult):
  match valid:
    case False{}:
      IO.pure(Socket & ReadResult, (s, ReadError{}))
    case True{}:
      do IO<Socket & ReadResult>:
        got : Socket & ReadResult <- read_exact(257n, s, n, [])
        body_received(got)

def read_prefix(got: Socket & ReadResult) -> IO(Socket & ReadResult):
  (s, r) = got
  match r:
    case Bytes{[a, b, c, d]}:
      +n = from_be(a, b, c, d)
      read_body(s, Bool.and(U32.is_ge(n, 8), U32.is_le(n, 256)), n)
    case other:
      IO.pure(Socket & ReadResult, (s, other))

def receive(s: Socket) -> IO(Socket & ReadResult):
  do IO<Socket & ReadResult>:
    got : Socket & ReadResult <- read_exact(5n, s, 4, [])
    read_prefix(got)

def parse_valid(ok: Bool, f: Frame) -> Maybe<&2, Frame>:
  match ok:
    case False{}:
      None{}
    case True{}:
      Some{f}

def parse(bytes: List<&2, U32>) -> Maybe<&2, Frame>:
  match bytes:
    case v <> +k <> a <> b <> c <> d <> e <> f <> payload:
      parse_valid(Bool.and(U32.is_eq(v, 1), Bool.and(U32.is_ge(k, 1), U32.is_le(k, 4))),
        Frame{k, from_be(a, b, c, d), ((e << 8n : U32) .|. f : U32), payload})
    case other:
      None{}

def encode(frame: Frame) -> List<&2, U32>:
  match frame:
    case Frame{k, id, +op, payload}:
      +body = List.append(&2, U32, [1, k], List.append(&2, U32, u32be(id),
        (op >> 8n : U32) <> (op .&. 255 : U32) <> payload))
      List.append(&2, U32, u32be(U32.from_nat(List.length(&2, U32, body))), body)

def sent(got: Socket & Result<&1, &1, (U32 & String) & List<&2, U32>, Unit>, next: Socket -> IO(Unit)) -> IO(Unit):
  (s, r) = got
  match r:
    case Fail{e}:
      Socket.close(s)
    case Done{u}:
      next(s)

def send(s: Socket, frame: Frame, next: Socket -> IO(Unit)) -> IO(Unit):
  do IO<Unit>:
    got : Socket & Result<&1, &1, (U32 & String) & List<&2, U32>, Unit> <- TCP.send_bytes(s, encode(frame))
    sent(got, next)
