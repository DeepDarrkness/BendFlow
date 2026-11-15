import Base
import ./loop.bend as Loop
import ./custom-app.bend as Custom

def contract(_: Unit) -> List<&2, U32>:
  [66, 101, 110, 100, 70, 108, 111, 119, 47, 99, 117, 115, 116, 111, 109, 47, 118, 49]

def shutdown(state: Custom.State) -> IO(Unit):
  IO.pure(Unit, Unit{})

def applied(state: Custom.State, command: Maybe<&2, Custom.Command>) -> IO(Custom.State & List<&2, U32>):
  match command:
    case None{}:
      IO.pure(Custom.State & List<&2, U32>, (state, Loop.invalid()))
    case Some{cmd}:
      Custom.step(state, cmd)

def handle_other(state: Custom.State) -> IO(Custom.State & List<&2, U32>):
  IO.pure(Custom.State & List<&2, U32>, (state, Loop.ok()))

def handle_cmd(cmd: Bool, state: Custom.State, payload: List<&2, U32>) -> IO(Custom.State & List<&2, U32>):
  match cmd:
    case True{}:
      applied(state, Custom.take_command(payload))
    case False{}:
      handle_other(state)

def handle(state: Custom.State, op: U32, payload: List<&2, U32>) -> IO(Custom.State & List<&2, U32>):
  handle_cmd(U32.is_eq(op, 1), state, payload)

def main() -> IO(Unit):
  Loop.run(~Custom.State, ~handle, ~shutdown, ~contract, ~"usage: custom-worker PORT", Custom.initial())
