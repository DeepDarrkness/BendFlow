import Base
import ../../../bend/numeric.bend as Numeric

def main() -> Numeric.State & List<&2, U32>:
  Numeric.step(Numeric.Numeric{7n, 3, 4294967295, 9}, Numeric.Add{0})
