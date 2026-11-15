import Base
import ../../../bend/collection-features.bend as Features
def bad(value: U32) -> U32:
  closure = Features.adder(1)
  Features.twice(~closure, value)
