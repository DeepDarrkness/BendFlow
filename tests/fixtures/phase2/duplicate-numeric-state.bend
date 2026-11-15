import Base
import ../../../bend/numeric.bend as Numeric

def duplicate(state: Numeric.State) -> Numeric.State & Numeric.State:
  (state, state)
