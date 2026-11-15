import Base
import ./loop.bend as Loop
import ./network-app.bend as Nets

def contract(_: Unit) -> List<&2, U32>:
  [66, 101, 110, 100, 70, 108, 111, 119, 47, 110, 101, 116, 119, 111, 114, 107, 47, 118, 49]

def applied(state: Nets.State, command: Maybe<&2, Nets.Command>) -> IO(Nets.State & List<&2, U32>):
  match command:
    case None{}:
      IO.pure(Nets.State & List<&2, U32>, (state, Loop.invalid()))
    case Some{cmd}:
      Nets.step(state, cmd)

def handle_other(state: Nets.State) -> IO(Nets.State & List<&2, U32>):
  IO.pure(Nets.State & List<&2, U32>, (state, Loop.ok()))

def handle_cmd(cmd: Bool, state: Nets.State, payload: List<&2, U32>) -> IO(Nets.State & List<&2, U32>):
  match cmd:
    case True{}:
      applied(state, Nets.take_command(payload))
    case False{}:
      handle_other(state)

def handle(state: Nets.State, op: U32, payload: List<&2, U32>) -> IO(Nets.State & List<&2, U32>):
  handle_cmd(U32.is_eq(op, 1), state, payload)

def main() -> IO(Unit):
  Loop.run(~Nets.State, ~handle, ~Nets.shutdown, ~contract, ~"usage: network-worker PORT", Nets.initial())
