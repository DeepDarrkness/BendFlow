import Base

def api.glyph(+value: Char) -> Char:
  value

def api.repeat(+value: List<&2, Char>) -> List<&2, Char>:
  List.append(&2, Char, value, value)

type Choice is Data:
  NoLetters{}
  Letters{values: List<&2, Char>}

type Shape is Data:
  Shape{glyph: Char, rows: List<&2, List<&2, Char>>, choice: Choice}

def api.shape(+value: Shape) -> Shape:
  value

def api.tuple(value: Char & (List<&2, Char> & Char)) -> Char & (List<&2, Char> & Char):
  value

def api.invalid(+code: U32) -> Shape:
  Shape{Chr{code}, [], NoLetters{}}

type Observed is Type:
  Observed{file: File, calls: U32}

def lifecycle.init.observed() -> IO(Observed):
  do IO<Observed>:
    path : String <- IO.try(String, IO.get_env("BENDFLOW_SERVICE_FILE"))
    file : File <- IO.try(File, File.open(path, "w"))
    return Observed{file, 0}

def observed.closed(got: File & Result<&1, &1, U32 & String, Unit>) -> IO(Unit):
  (file, result) = got
  do IO<Unit>:
    Unit <- File.close(file)
    IO.print("char finalized")

def lifecycle.finalize.observed(state: Observed) -> IO(Unit):
  match state:
    case Observed{file, calls}:
      do IO<Unit>:
        got : File & Result<&1, &1, U32 & String, Unit> <- File.write(file, "|closed")
        observed.closed(got)

def observed.written(got: File & Result<&1, &1, U32 & String, Unit>, +calls: U32, value: Char) -> Observed & (Char & U32):
  (file, result) = got
  (Observed{file, calls}, (value, calls))

def api.observed(state: Observed, +value: Char, +letters: List<&2, Char>) -> IO(Observed & (Char & U32)):
  match state:
    case Observed{file, calls}:
      do IO<Observed & (Char & U32)>:
        got : File & Result<&1, &1, U32 & String, Unit> <- File.write(file, SCon{value, SNil{}})
        return observed.written(got, (calls + 1 : U32), value)

def balanced(+depth: Nat) -> U32:
  match depth:
    case 0n:
      1
    case 1n+p:
      a b = balanced(p) balanced(p)
      (a + b : U32)

type WorkReply is Data:
  WorkReply{threads: U32, sum: U32, calls: U32}

def lifecycle.init.work() -> IO(U32):
  IO.pure(U32, 0)

def lifecycle.finalize.work(state: U32) -> IO(Unit):
  IO.pure(Unit, Unit{})

def api.work(state: U32, +depth: Nat) -> IO(U32 & WorkReply):
  do IO<U32 & WorkReply>:
    threads : U32 <- IO.thread_count()
    +calls : U32 = (state + 1 : U32)
    return (calls, WorkReply{threads, balanced(depth), calls})
