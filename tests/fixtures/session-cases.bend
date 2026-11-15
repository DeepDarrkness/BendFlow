import Base
import ../../bend/session.bend as Session

def snapshot(kind: String, value: Session.Snapshot) -> String:
  match value:
    case Session.Snapshot{total, count}:
      kind ++ ":" ++ U32.show(total) ++ ":" ++ U32.show(count)

def report(result: Session.State & Session.Reply) -> IO(Unit):
  (state, reply) = result
  match reply:
    case Session.Value{value}:
      IO.print(snapshot("value", value))
    case Session.Overflow{value}:
      IO.print(snapshot("overflow", value))

def main() -> IO(Unit):
  do IO<Unit>:
    report(Session.step((Session.initial(), Session.Add{7})))
    report(Session.step((Session.initial(), Session.Add{0})))
    report(Session.step((Session.initial(), Session.Read{})))
    report(Session.step((Session.SessionState{4294967295, 1}, Session.Add{0})))
    report(Session.step((Session.SessionState{4294967294, 1}, Session.Add{1})))
    report(Session.step((Session.SessionState{4294967295, 1}, Session.Add{1})))
    report(Session.step((Session.SessionState{4294967295, 1}, Session.Add{4294967295})))
    report(Session.step((Session.SessionState{7, 4294967295}, Session.Add{0})))
    report(Session.step((Session.SessionState{7, 4294967295}, Session.Read{})))
    report(Session.step((Session.SessionState{7, 4294967295}, Session.Reset{})))
