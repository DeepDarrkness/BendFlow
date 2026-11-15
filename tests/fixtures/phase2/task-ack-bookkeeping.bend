import Base
import ../../../bend/task-app.bend as Task

def take_state(got: Task.State & List<&2, U32>) -> Task.State:
  (state, reply) = got
  state

def report(state: Task.State, label: String) -> IO(Task.State):
  match state:
    case Task.Jobs{next, open, resources, +late}:
      do IO<Task.State>:
        Unit <- IO.print(label ++ Nat.show(List.length(&2, Chan(Unit), late)))
        return Task.Jobs{next, open, resources, late}

def successes(n: Nat, state: Task.State) -> IO(Task.State):
  match n:
    case 0n:
      report(state, "successful pending: ")
    case 1n+p:
      do IO<Task.State>:
        got : Task.State & List<&2, U32> <- Task.step(state, Task.Timeout{1000, 0, "early"})
        successes(p, take_state(got))

def await_and_restore_ack(late: List<&2, Chan(Unit)>) -> IO(List<&2, Chan(Unit)>):
  match late:
    case Nil{}:
      IO.die(List<&2, Chan(Unit)>, 1, "missing pending acknowledgement")
    case +ack <> rest:
      do IO<List<&2, Chan(Unit)>>:
        done : Maybe<&1, Unit> <- Chan.recv(Unit, ack)
        sent : Result<&1, &1, Unit, Unit> <- Chan.send(Unit, ack, Unit{})
        return ack <> rest

def await_completion(state: Task.State) -> IO(Task.State):
  match state:
    case Task.Jobs{next, open, resources, late}:
      do IO<Task.State>:
        completed : List<&2, Chan(Unit)> <- await_and_restore_ack(late)
        return Task.Jobs{next, open, resources, completed}

def late_completions(n: Nat, state: Task.State) -> IO(Task.State):
  match n:
    case 0n:
      report(state, "late pending: ")
    case 1n+p:
      do IO<Task.State>:
        got : Task.State & List<&2, U32> <- Task.step(state, Task.Timeout{0, 10, "late"})
        completed : Task.State <- await_completion(take_state(got))
        reaped : Task.State & List<&2, U32> <- Task.step(completed, Task.Nap{0})
        late_completions(p, take_state(reaped))

def main() -> IO(Unit):
  do IO<Unit>:
    early : Task.State <- successes(64n, Task.initial())
    Unit <- Task.shutdown(early)
    late : Task.State <- late_completions(64n, Task.initial())
    Task.shutdown(late)
