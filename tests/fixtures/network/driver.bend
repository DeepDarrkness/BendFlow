import Base
import ../../../bend/network-app.bend as Nets
import ../../../bend/loop.bend as Loop

def contract(_: Unit) -> List<&2, U32>:
  [66, 101, 110, 100, 70, 108, 111, 119, 47, 110, 101, 116, 119, 111, 114, 107, 47, 118, 49]

def applied(state: Nets.State, command: Maybe<&2, Nets.Command>) -> IO(Nets.State & List<&2, U32>):
  match command:
    case None{}:
      IO.pure(Nets.State & List<&2, U32>, (state, Loop.invalid()))
    case Some{command}:
      Nets.step(state, command)

def handle(state: Nets.State, op: U32, payload: List<&2, U32>) -> IO(Nets.State & List<&2, U32>):
  match op:
    case 1:
      applied(state, Nets.take_command(payload))
    case other:
      IO.pure(Nets.State & List<&2, U32>, (state, Loop.ok()))

def shutdown(state: Nets.State) -> IO(Unit):
  do IO<Unit>:
    Unit <- Nets.shutdown(state)
    IO.print("network-cleanup-complete")

def withheld(got: Nets.State & List<&2, U32>) -> IO(Nets.State & List<&2, U32>):
  do IO<Nets.State & List<&2, U32>>:
    IO.sleep(10000)
    return got

def uncertain_applied(state: Nets.State, command: Maybe<&2, Nets.Command>) -> IO(Nets.State & List<&2, U32>):
  match command:
    case Some{Nets.Send{id, bytes}}:
      do IO<Nets.State & List<&2, U32>>:
        got : Nets.State & List<&2, U32> <- Nets.step(state, Nets.Send{id, bytes})
        withheld(got)
    case other:
      applied(state, other)

def uncertain_handle(state: Nets.State, op: U32, payload: List<&2, U32>) -> IO(Nets.State & List<&2, U32>):
  match op:
    case 1:
      uncertain_applied(state, Nets.take_command(payload))
    case other:
      IO.pure(Nets.State & List<&2, U32>, (state, Loop.ok()))
