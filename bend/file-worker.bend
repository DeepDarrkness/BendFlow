import Base
import ./loop.bend as Loop
import ./file-app.bend as Files

def contract(_: Unit) -> List<&2, U32>:
  [66, 101, 110, 100, 70, 108, 111, 119, 47, 102, 105, 108, 101, 47, 118, 49]

def applied(state: Files.State, command: Maybe<&2, Files.Command>) -> IO(Files.State & List<&2, U32>):
  match command:
    case None{}:
      IO.pure(Files.State & List<&2, U32>, (state, Loop.invalid()))
    case Some{cmd}:
      Files.step(state, cmd)

def handle_other(state: Files.State) -> IO(Files.State & List<&2, U32>):
  IO.pure(Files.State & List<&2, U32>, (state, Loop.ok()))

def handle_cmd(cmd: Bool, state: Files.State, payload: List<&2, U32>) -> IO(Files.State & List<&2, U32>):
  match cmd:
    case True{}:
      applied(state, Files.take_command(payload))
    case False{}:
      handle_other(state)

def handle(state: Files.State, op: U32, payload: List<&2, U32>) -> IO(Files.State & List<&2, U32>):
  handle_cmd(U32.is_eq(op, 1), state, payload)

def main() -> IO(Unit):
  Loop.run(~Files.State, ~handle, ~Files.shutdown, ~contract, ~"usage: file-worker PORT", Files.initial())
