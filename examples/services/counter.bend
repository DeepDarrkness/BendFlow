import Base
import ./helpers.bend as Helpers

type CounterState is Type:
  CounterState{total: U32}

type Increment is Data:
  Increment{amount: U32}

type CounterReply is Data:
  CounterReply{value: U32}

def lifecycle.init.counter() -> IO(CounterState):
  IO.pure(CounterState, CounterState{0})

def lifecycle.finalize.counter(state: CounterState) -> IO(Unit):
  IO.print("counter finalized")

def counter_step(state: CounterState, request: Increment) -> CounterState & CounterReply:
  match state request:
    case CounterState{total} Increment{amount}:
      +next = Helpers.add(total, amount)
      (CounterState{next}, CounterReply{next})

def api.counter(state: CounterState, request: Increment) -> IO(CounterState & CounterReply):
  do IO<CounterState & CounterReply>:
    IO.sleep(20)
    return counter_step(state, request)

type AccumulatorState is Type:
  AccumulatorState{sum: U32, calls: U32}

type Sample is Data:
  Sample{delta: U32, weight: U32}

type Reading is Data:
  Reading{running: U32, calls: U32}

def lifecycle.init.accumulate() -> IO(AccumulatorState):
  IO.pure(AccumulatorState, AccumulatorState{10, 0})

def lifecycle.finalize.accumulate(state: AccumulatorState) -> IO(Unit):
  IO.pure(Unit, Unit{})

def api.accumulate(state: AccumulatorState, sample: Sample) -> IO(AccumulatorState & Reading):
  match state sample:
    case AccumulatorState{sum, calls} Sample{delta, weight}:
      +next = (sum + (delta * weight : U32) : U32)
      +count = (calls + 1 : U32)
      IO.pure(AccumulatorState & Reading, (AccumulatorState{next, count}, Reading{next, count}))
