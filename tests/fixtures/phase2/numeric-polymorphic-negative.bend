import Base

def identity(-A: Type, value: A) -> A:
  value

def wrong() -> U32:
  identity(U32, True{})
