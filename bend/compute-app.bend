import Base
import ./bytes.bend as Bytes

type State is Data:
  ComputeIdle{}

type Command is Data:
  Sum{items: List<&2, U32>}
  Threads{}
  Frame{}

def initial() -> State:
  ComputeIdle{}

def add2(+a: U32, +b: U32) -> U32:
  (a + b : U32)

def sum(xs: List<&2, U32>) -> U32:
  match xs:
    case Nil{}:
      0
    case h <> Nil{}:
      h
    case a <> b <> rest:
      x y = add2(a, b) sum(rest)
      add2(x, y)

def pixels(img: Image) -> List<&2, U32>:
  match img:
    case Pix{color}:
      color <> Nil{}
    case Qua{tl, tr, bl, br}:
      List.append(&2, U32, pixels(tl), List.append(&2, U32, pixels(tr), List.append(&2, U32, pixels(bl), pixels(br))))

def frame() -> List<&2, U32>:
  pixels(Qua{Pix{1}, Pix{2}, Pix{3}, Pix{4}})

def encode_u32(tag: U32, n: U32) -> List<&2, U32>:
  tag <> Bytes.encode_u32(n)

def step(state: State, command: Command) -> IO(State & List<&2, U32>):
  match command:
    case Sum{items}:
      IO.pure(State & List<&2, U32>, (state, encode_u32(0, sum(items))))
    case Threads{}:
      do IO<State & List<&2, U32>>:
        n : U32 <- IO.thread_count()
        return (state, encode_u32(1, n))
    case Frame{}:
      IO.pure(State & List<&2, U32>, (state, 2 <> Bytes.encode_u32s(frame())))

def finish_sum(ok: Bool, items: List<&2, U32>) -> Maybe<&2, Command>:
  match ok:
    case True{}:
      Some{Sum{items}}
    case False{}:
      None{}

def take_sum(got: Maybe<&2, Bytes.SplitU32s>) -> Maybe<&2, Command>:
  match got:
    case None{}:
      None{}
    case Some{Bytes.SplitU32s{items, more}}:
      finish_sum(Bytes.finished(more), items)

def take_command(payload: List<&2, U32>) -> Maybe<&2, Command>:
  match payload:
    case 0 <> rest:
      take_sum(Bytes.take_u32s(32, rest))
    case [1]:
      Some{Threads{}}
    case [2]:
      Some{Frame{}}
    case other:
      None{}
