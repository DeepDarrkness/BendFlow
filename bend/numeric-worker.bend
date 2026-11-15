import Base
import ./loop.bend as Loop
import ./numeric.bend as Numeric

def contract(_: Unit) -> List<&2, U32>:
  [66, 101, 110, 100, 70, 108, 111, 119, 47, 110, 117, 109, 101, 114, 105, 99, 47, 118, 49]

def shutdown(state: Numeric.State) -> IO(Unit):
  IO.pure(Unit, Unit{})

def applied(state: Numeric.State, command: Maybe<&2, Numeric.Command>) -> Numeric.State & List<&2, U32>:
  match command:
    case None{}:
      (state, Loop.invalid())
    case Some{cmd}:
      Numeric.step(state, cmd)

def handle_other(state: Numeric.State) -> Numeric.State & List<&2, U32>:
  (state, Loop.ok())

def handle_cmd(cmd: Bool, state: Numeric.State, payload: List<&2, U32>) -> Numeric.State & List<&2, U32>:
  match cmd:
    case True{}:
      applied(state, Numeric.take_command(payload))
    case False{}:
      handle_other(state)

def handle(state: Numeric.State, op: U32, payload: List<&2, U32>) -> IO(Numeric.State & List<&2, U32>):
  IO.pure(Numeric.State & List<&2, U32>, handle_cmd(U32.is_eq(op, 1), state, payload))

def main() -> IO(Unit):
  Loop.run(~Numeric.State, ~handle, ~shutdown, ~contract, ~"usage: numeric-worker PORT", Numeric.initial())

