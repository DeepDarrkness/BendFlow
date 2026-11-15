import Base
import ./loop.bend as Loop
import ./task-app.bend as Tasks

def contract(_: Unit) -> List<&2, U32>:
  [66, 101, 110, 100, 70, 108, 111, 119, 47, 116, 97, 115, 107, 47, 118, 49]

def applied(state: Tasks.State, command: Maybe<&2, Tasks.Command>) -> IO(Tasks.State & List<&2, U32>):
  match command:
    case None{}:
      IO.pure(Tasks.State & List<&2, U32>, (state, Loop.invalid()))
    case Some{cmd}:
      Tasks.step(state, cmd)

def handle_other(state: Tasks.State) -> IO(Tasks.State & List<&2, U32>):
  IO.pure(Tasks.State & List<&2, U32>, (state, Loop.ok()))

def handle_cmd(cmd: Bool, state: Tasks.State, payload: List<&2, U32>) -> IO(Tasks.State & List<&2, U32>):
  match cmd:
    case True{}:
      applied(state, Tasks.take_command(payload))
    case False{}:
      handle_other(state)

def handle(state: Tasks.State, op: U32, payload: List<&2, U32>) -> IO(Tasks.State & List<&2, U32>):
  handle_cmd(U32.is_eq(op, 1), state, payload)

def main() -> IO(Unit):
  Loop.run(~Tasks.State, ~handle, ~Tasks.shutdown, ~contract, ~"usage: task-worker PORT", Tasks.initial())
