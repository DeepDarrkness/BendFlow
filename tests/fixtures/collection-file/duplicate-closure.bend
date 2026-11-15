import Base
def bad(closure: U32 -> U32) -> U32:
  (closure(1) + closure(2) : U32)
