import Base
import ../../bend/session.bend as Session

def duplicate(state: Session.State) -> Session.State & Session.State:
  (state, state)
