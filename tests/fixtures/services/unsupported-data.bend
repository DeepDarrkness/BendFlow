import Base

type State is Type:
  State{value: U32}

type Request is Data:
  Request{amount: Cmp}

type Reply is Data:
  Reply{value: U32}

def lifecycle.init.bad() -> IO(State):
  IO.pure(State, State{0})

def lifecycle.finalize.bad(state: State) -> IO(Unit):
  IO.pure(Unit, Unit{})

def api.bad(state: State, request: Request) -> IO(State & Reply):
  IO.pure(State & Reply, (state, Reply{0}))
