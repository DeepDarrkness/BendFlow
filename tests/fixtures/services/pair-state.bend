import Base

type Box<-A: Type> is Type:
  Box{value: A}

def lifecycle.init.answer() -> IO(((U32 & Bool) & Unit)):
  IO.pure(((U32 & Bool) & Unit), ((42, True{}), Unit{}))

def lifecycle.finalize.answer(state: ((U32 & Bool) & Unit)) -> IO(Unit):
  IO.print("pair finalized")

def api.answer(state: ((U32 & Bool) & Unit)) -> IO((((U32 & Bool) & Unit) & U32)):
  ((+value, enabled), unit) = state
  IO.pure((((U32 & Bool) & Unit) & U32), (((value, enabled), unit), value))

def lifecycle.init.nested() -> IO(Box<((U32 & Bool) & Unit)>):
  IO.pure(Box<((U32 & Bool) & Unit)>, Box{((42, True{}), Unit{})})

def lifecycle.finalize.nested(state: Box<((U32 & Bool) & Unit)>) -> IO(Unit):
  IO.print("nested finalized")

def api.nested(state: Box<((U32 & Bool) & Unit)>) -> IO(Box<((U32 & Bool) & Unit)> & U32):
  Box{((+value, enabled), unit)} = state
  IO.pure(Box<((U32 & Bool) & Unit)> & U32, (Box{((value, enabled), unit)}, value))
