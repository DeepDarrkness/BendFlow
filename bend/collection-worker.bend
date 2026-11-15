import Base
import ./loop.bend as Loop
import ./collection.bend as Collection

def contract(_: Unit) -> List<&2, U32>:
  [66, 101, 110, 100, 70, 108, 111, 119, 47, 99, 111, 108, 108, 101, 99, 116, 105, 111, 110, 47, 118, 49]

def shutdown(state: Collection.State) -> IO(Unit):
  IO.pure(Unit, Unit{})

def applied(state: Collection.State, command: Maybe<&2, Collection.Command>) -> Collection.State & List<&2, U32>:
  match command:
    case None{}:
      (state, Loop.invalid())
    case Some{cmd}:
      Collection.step(state, cmd)

def handle_other(state: Collection.State) -> Collection.State & List<&2, U32>:
  (state, Loop.ok())

def handle_cmd(cmd: Bool, state: Collection.State, payload: List<&2, U32>) -> Collection.State & List<&2, U32>:
  match cmd:
    case True{}:
      applied(state, Collection.take_command(payload))
    case False{}:
      handle_other(state)

def handle(state: Collection.State, op: U32, payload: List<&2, U32>) -> IO(Collection.State & List<&2, U32>):
  IO.pure(Collection.State & List<&2, U32>, handle_cmd(U32.is_eq(op, 1), state, payload))

def main() -> IO(Unit):
  Loop.run(~Collection.State, ~handle, ~shutdown, ~contract, ~"usage: collection-worker PORT", Collection.initial())
