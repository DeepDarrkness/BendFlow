import Base

type State is Type:
  State{value: U32}

type Request is Data:
  Request{amount: U32}

type Reply is Data:
  Reply{value: U32}

def lifecycle.init.validated() -> IO(State):
  IO.pure(State, State{0})

def lifecycle.finalize.validated(state: State) -> IO(Unit):
  IO.pure(Unit, Unit{})

def api.validated(state: State, request: Request) -> IO(State & Reply):
  IO.pure(State & Reply, (state, Reply{37}))

def lifecycle.init.define() -> IO(State):
  IO.pure(State, State{0})

def lifecycle.finalize.define(state: State) -> IO(Unit):
  IO.pure(Unit, Unit{})

def api.define(state: State, request: Request) -> IO(State & Reply):
  IO.pure(State & Reply, (state, Reply{81}))
