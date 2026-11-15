import Base
import ../../../../bend/compute-app.bend as Compute
import ../../../../bend/compute-core.bend as Core

def bytes(got: Compute.State & List<&2, U32>) -> List<&2, U32>:
  (state, payload) = got
  payload

def execute(state: Compute.State, command: Compute.Command) -> List<&2, U32>:
  bytes(Compute.pure(~Core.sum, ~Core.sort, ~Core.image, ~Core.buffer, state, command))

def seeded() -> Compute.State:
  Compute.State{Core.Simulation{7, 19, 2, False{}, True{}}, 43, Some{Compute.Snapshot{42, [0, 2147483648, 4294967295]}}}

def full() -> Compute.State:
  Compute.State{Core.initial(), 43, Some{Compute.Snapshot{42, [
    0, 1, 2, 3, 4, 5, 6, 7,
    8, 9, 10, 11, 12, 13, 14, 15,
    16, 17, 18, 19, 20, 21, 22, 23,
    24, 25, 26, 27, 28, 29, 30, 4294967295]}}}

def exhausted() -> Compute.State:
  Compute.State{Core.initial(), 4294967295, None{}}

def overflow() -> Compute.State:
  Compute.State{Core.Simulation{10000, 255, 2, True{}, False{}}, 1, None{}}
