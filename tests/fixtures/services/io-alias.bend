import Base

def Reply() -> Type:
  IO(U32)

def Effect(-A: Type) -> Type:
  IO(A)

def Again(-A: Type) -> Type:
  Effect(A)

def Identity(A: Type) -> Type:
  A

def api.answer() -> Reply():
  IO.pure(U32, 42)

def api.generic() -> Again(U32):
  IO.pure(U32, 43)

def api.nested() -> Identity(Identity(IO(U32))):
  IO.pure(U32, 44)

def lifecycle.init.state() -> Again(U32):
  IO.pure(U32, 40)

def lifecycle.finalize.state(value: U32) -> Effect(Unit):
  IO.print("alias finalized")

def api.state(value: U32) -> Again(U32 & U32):
  +next = (value + 1 : U32)
  IO.pure(U32 & U32, (next, next))
