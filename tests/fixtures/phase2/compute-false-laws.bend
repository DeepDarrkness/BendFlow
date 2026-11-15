import Base
import ../../../bend/compute-core.bend as Core

law descending:
  {Core.sort(Core.Leaf{[2, 1]}) == [2, 1] : List<&2, U32>}
