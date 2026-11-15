import Base

type State is Type:
  SessionState{total: U32, accepted_adds: U32}

type Command is Data:
  Add{amount: U32}
  Read{}
  Reset{}

type Snapshot is Data:
  Snapshot{total: U32, accepted_adds: U32}

type Reply is Data:
  Value{value: Snapshot}
  Overflow{value: Snapshot}

def initial() -> State:
  SessionState{0, 0}

def add_result(valid: Bool, +total: U32, +count: U32, amount: U32) -> State & Reply:
  match valid:
    case False{}:
      (SessionState{total, count}, Overflow{Snapshot{total, count}})
    case True{}:
      +next_total = (total + amount : U32)
      +next_count = (count + 1 : U32)
      (SessionState{next_total, next_count}, Value{Snapshot{next_total, next_count}})

def step(input: State & Command) -> State & Reply:
  (state, command) = input
  match state command:
    case SessionState{+total, +count} Add{+amount}:
      add_result(Bool.and(U32.is_le(amount, (4294967295 - total : U32)), U32.is_ne(count, 4294967295)), total, count, amount)
    case SessionState{+total, +count} Read{}:
      (SessionState{total, count}, Value{Snapshot{total, count}})
    case SessionState{total, count} Reset{}:
      (initial(), Value{Snapshot{0, 0}})
