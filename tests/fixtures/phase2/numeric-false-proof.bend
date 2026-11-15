import Base
import ../../../bend/numeric-core.bend as Core

law rejected_add_mutates:
  {Core.state(Core.add(3n, Core.Numeric{7n, 3n, 1n, 9}, 1n)) == Core.Numeric{7n, 4n, 2n, 9} : Core.State}

def rejected_add_mutates():
  {==}
