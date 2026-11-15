import Base
import ../../../bend/network-app.bend as Nets
import ../../../bend/bytes.bend as Bytes

def equal(a: List<&2, U32>, b: List<&2, U32>) -> Bool:
  match a b:
    case Nil{} Nil{}:
      True{}
    case x <> xs y <> ys:
      Bool.and(U32.is_eq(x, y), equal(xs, ys))
    case other other_b:
      False{}

def wire(tag: U32, bytes: List<&2, U32>) -> List<&2, U32>:
  tag <> bytes

def address(host: String, port: U32) -> List<&2, U32>:
  List.append(&2, U32, Bytes.encode_text(host), Bytes.encode_u32(port))

def fields(id: U32, rest: List<&2, U32>) -> List<&2, U32>:
  List.append(&2, U32, Bytes.encode_u32(id), rest)

def timed(rest: List<&2, U32>, ms: U32) -> List<&2, U32>:
  List.append(&2, U32, rest, Bytes.encode_u32(ms))

def encode(command: Maybe<&2, Nets.Command>) -> List<&2, U32>:
  match command:
    case None{}:
      [255]
    case Some{Nets.Connect{host, port}}:
      wire(0, address(host, port))
    case Some{Nets.Send{id, bytes}}:
      wire(1, fields(id, Bytes.encode_len_bytes(bytes)))
    case Some{Nets.Recv{id, max}}:
      wire(2, fields(id, Bytes.encode_u32(max)))
    case Some{Nets.Drop{id}}:
      wire(3, Bytes.encode_u32(id))
    case Some{Nets.Bind{host, port}}:
      wire(4, address(host, port))
    case Some{Nets.SendTo{id, host, port, bytes}}:
      wire(5, fields(id, List.append(&2, U32, address(host, port), Bytes.encode_len_bytes(bytes))))
    case Some{Nets.RecvFrom{id, max, ms}}:
      wire(6, fields(id, timed(Bytes.encode_u32(max), ms)))
    case Some{Nets.Listen{host, port}}:
      wire(7, address(host, port))
    case Some{Nets.Accept{id}}:
      wire(8, Bytes.encode_u32(id))
    case Some{Nets.TryAccept{id, ms}}:
      wire(9, fields(id, Bytes.encode_u32(ms)))
    case Some{Nets.TryRecv{id, max, ms}}:
      wire(10, fields(id, timed(Bytes.encode_u32(max), ms)))
    case Some{Nets.TrySend{id, bytes, ms}}:
      wire(11, fields(id, timed(Bytes.encode_len_bytes(bytes), ms)))
    case Some{Nets.TrySendTo{id, host, port, bytes, ms}}:
      wire(12, fields(id, timed(List.append(&2, U32, address(host, port), Bytes.encode_len_bytes(bytes)), ms)))

def check(vectors: List<&2, List<&2, U32>>) -> Bool:
  match vectors:
    case Nil{}:
      True{}
    case +payload <> rest:
      Bool.and(equal(encode(Nets.take_command(payload)), payload), check(rest))

def main() -> IO(Unit):
  IO.print(Bool.show(check([
    [0, 7, 49, 46, 50, 46, 51, 46, 52, 0, 0, 255, 255],
    [1, 0, 0, 0, 1, 2, 0, 255],
    [2, 0, 0, 0, 1, 0, 0, 0, 192],
    [3, 0, 0, 0, 1],
    [4, 7, 49, 46, 50, 46, 51, 46, 52, 0, 0, 0, 0],
    [5, 0, 0, 0, 1, 7, 49, 46, 50, 46, 51, 46, 52, 0, 0, 0, 1, 0],
    [6, 0, 0, 0, 1, 0, 0, 0, 192, 0, 0, 39, 16],
    [7, 7, 49, 46, 50, 46, 51, 46, 52, 0, 0, 0, 0],
    [8, 0, 0, 0, 1],
    [9, 0, 0, 0, 1, 0, 0, 0, 0],
    [10, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 39, 16],
    [11, 0, 0, 0, 1, 1, 255, 0, 0, 0, 1],
    [12, 0, 0, 0, 1, 7, 49, 46, 50, 46, 51, 46, 52, 0, 0, 0, 1, 1, 255, 0, 0, 0, 1]
  ])))
