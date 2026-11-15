import Base
import ./loop.bend as Loop
import ./compute-app.bend as Compute
import ./compute-gpu-core.bend as GPU

def contract(_: Unit) -> List<&2, U32>:
  [66, 101, 110, 100, 70, 108, 111, 119, 47, 99, 111, 109, 112, 117, 116, 101, 47, 118, 49]

def shutdown(state: Compute.State) -> IO(Unit):
  IO.pure(Unit, Unit{})

def applied(state: Compute.State, command: Maybe<&2, Compute.Command>) -> IO(Compute.State & List<&2, U32>):
  match command:
    case None{}:
      IO.pure(Compute.State & List<&2, U32>, (state, Loop.invalid()))
    case Some{cmd}:
      Compute.step(~GPU.sum, ~GPU.sort, ~GPU.image, ~GPU.buffer, state, cmd)

def handle_cmd(cmd: Bool, state: Compute.State, payload: List<&2, U32>) -> IO(Compute.State & List<&2, U32>):
  match cmd:
    case True{}:
      applied(state, Compute.take_command(payload))
    case False{}:
      IO.pure(Compute.State & List<&2, U32>, (state, Loop.ok()))

def handle(state: Compute.State, op: U32, payload: List<&2, U32>) -> IO(Compute.State & List<&2, U32>):
  handle_cmd(U32.is_eq(op, 1), state, payload)

def main() -> IO(Unit):
  Loop.run(~Compute.State, ~handle, ~shutdown, ~contract, ~"usage: compute-gpu-worker PORT", Compute.initial())
