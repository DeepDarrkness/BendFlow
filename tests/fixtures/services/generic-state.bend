import Base

type State<-A: Data> is Type:
  State{value: A}

type Change is Data:
  Change{amount: U32}

type Value is Data:
  Value{value: U32}

def lifecycle.init.counter() -> IO(State<U32>):
  IO.pure(State<U32>, State{0})

def lifecycle.finalize.counter(state: State<U32>) -> IO(Unit):
  IO.pure(Unit, Unit{})

def api.counter(state: State<U32>, request: Change) -> IO(State<U32> & Value):
  match state request:
    case State{value} Change{amount}:
      +next = (value + amount : U32)
      IO.pure(State<U32> & Value, (State{next}, Value{next}))
