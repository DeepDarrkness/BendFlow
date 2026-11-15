import Base
import ../../../bend/collection-features.bend as Features
def bad() -> U32:
  Features.first(0n, Unit{})
