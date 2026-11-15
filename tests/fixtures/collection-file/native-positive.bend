import Base
import ./positive.bend as Positive
import ./snapshot-exhaustion.bend as Exhaustion

def show(values: List<&2, U32>) -> String:
  match values:
    case Nil{}:
      ""
    case h <> t:
      U32.show(h) ++ " " ++ show(t)

def main() -> IO(Unit):
  do IO<Unit>:
    IO.print(show(Positive.main()))
    IO.print(show(Exhaustion.main()))
