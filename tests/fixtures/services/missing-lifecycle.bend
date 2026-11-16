import Base

type State is Type:
  State{value: U32}

type Request is Data:
  Request{amount: U32}

type Reply is Data:
  Reply{value: U32}

def lifecycle.init.bad() -> IO(State):
  IO.pure(State, State{0})

def api.bad(state: State, request: Request) -> IO(State & Reply):
  IO.pure(State & Reply, (state, Reply{0}))
