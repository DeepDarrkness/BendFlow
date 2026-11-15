import Base
import ../../../../bend/task-app.bend as Tasks
import ../../../../bend/task-resources.bend as Resources
import ../../../../bend/network-app.bend as Nets

def show_bytes.go(xs: List<&2, U32>, acc: String) -> String:
  match xs:
    case Nil{}:
      acc ++ "]"
    case h <> t:
      show_bytes.go(t, acc ++ "," ++ U32.show(h))

def show_bytes(xs: List<&2, U32>) -> String:
  match xs:
    case Nil{}:
      "[]"
    case h <> t:
      show_bytes.go(t, "[" ++ U32.show(h))

def task_result(got: Tasks.State & List<&2, U32>) -> IO(Unit):
  (state, reply) = got
  do IO<Unit>:
    Unit <- IO.print(show_bytes(reply))
    Tasks.shutdown(state)

def network_result(got: Nets.State & List<&2, U32>) -> IO(Nets.State):
  (state, reply) = got
  do IO<Nets.State>:
    Unit <- IO.print(show_bytes(reply))
    return state

def main() -> IO(Unit):
  do IO<Unit>:
    +ack : Chan(Unit) <- Chan.new(Unit, 1)
    sent : Result<&1, &1, Unit, Unit> <- Chan.send(Unit, ack, Unit{})
    timed : Tasks.State & List<&2, U32> <- Tasks.timeout_completed(1, Map.new(&2, Chan(String)), Resources.initial(), [], ack, None{})
    Unit <- task_result(timed)
    socket : Socket <- IO.try(Socket, UDP.bind("127.0.0.1", 0))
    network_state : Nets.State <- network_result(Nets.opened_socket(4294967295, Map.new(&1, Nets.Resource), 4, Done{socket}))
    wrong : Nets.State & List<&2, U32> <- Nets.step(network_state, Nets.TryAccept{4294967295, 0})
    network_state : Nets.State <- network_result(wrong)
    Unit <- Nets.shutdown(network_state)
    missing : Nets.State & List<&2, U32> <- Nets.step(Nets.initial(), Nets.Drop{1})
    missing_state : Nets.State <- network_result(missing)
    Unit <- Nets.shutdown(missing_state)
    exhausted : Nets.State & List<&2, U32> <- Nets.open_socket(False{}, 0, Map.new(&1, Nets.Resource), 4, "127.0.0.1", 0)
    exhausted_state : Nets.State <- network_result(exhausted)
    Unit <- Nets.shutdown(exhausted_state)
    return Unit{}
