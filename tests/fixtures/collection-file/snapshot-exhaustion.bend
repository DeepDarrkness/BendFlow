import Base
import ../../../bend/pages.bend as Pages

def after_last(got: Pages.Snapshot & List<&2, U32>) -> Pages.Snapshot & List<&2, U32>:
  (snapshot, reply) = got
  Pages.capture(snapshot, [99])

def observed(got: Pages.Snapshot & List<&2, U32>) -> List<&2, U32>:
  (snapshot, reply) = got
  match snapshot:
    case Pages.Snapshot{next, token, data}:
      List.append(&2, U32, [next, token], List.append(&2, U32, data, reply))

def main() -> List<&2, U32>:
  observed(after_last(Pages.capture(Pages.Snapshot{4294967295, 7, [1]}, [42])))
