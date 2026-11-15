import Base
import ./bytes.bend as Bytes
import ./compute-core.bend as Core
import ./compute-state.bend as Budget
import ./pages.bend as Pages

type Snapshot is Data:
  Snapshot{id: U32, items: List<&2, U32>}

type State is Data:
  State{simulation: Core.Simulation, next: U32, snapshot: Maybe<&2, Snapshot>}

type Command is Data:
  Sum{items: List<&2, U32>}
  Threads{}
  Frame{}
  Sort{items: List<&2, U32>}
  Advance{steps: U32}
  Inspect{}
  Reset{}
  ApplyEvent{event: Event}
  Render{depth: U32}
  Samples{count: U32}
  Page{id: U32, offset: U32, max: U32}
  Release{id: U32}

def initial() -> State:
  State{Core.initial(), 1, None{}}

def encode_u32(tag: U32, n: U32) -> List<&2, U32>:
  tag <> Bytes.encode_u32(n)

def simulation(s: Core.Simulation) -> List<&2, U32>:
  match s:
    case Core.Simulation{tick, position, velocity, running, closed}:
      4 <> List.append(&2, U32, Bytes.encode_u32(tick), List.append(&2, U32, Bytes.encode_u32(position), List.append(&2, U32, Bytes.encode_u32(velocity), [Bytes.bool_u8(running), Bytes.bool_u8(closed)])))

def observed(+s: Core.Simulation, next: U32, snapshot: Maybe<&2, Snapshot>) -> State & List<&2, U32>:
  (State{s, next, snapshot}, simulation(s))

def advanced(ok: Bool, steps: U32, s: Core.Simulation, next: U32, snapshot: Maybe<&2, Snapshot>) -> State & List<&2, U32>:
  match ok:
    case False{}:
      (State{s, next, snapshot}, [8, 4])
    case True{}:
      observed(Core.advance(U32.to_nat(steps), s), next, snapshot)

def capture(ok: Bool, s: Core.Simulation, +next: U32, +items: List<&2, U32>) -> State & List<&2, U32>:
  match ok:
    case False{}:
      (State{s, next, None{}}, [8, 3])
    case True{}:
      (State{s, (next + 1 : U32), Some{Snapshot{next, items}}}, Pages.descriptor(next, items))

def page_reply(id: U32, +offset: U32, +total: U32, +items: List<&2, U32>) -> List<&2, U32>:
  Pages.envelope(id, offset, total, Pages.length(items), Bytes.encode_u32s(items))

def paged(ok: Bool, state: State, id: U32, +offset: U32, total: U32, items: List<&2, U32>, max: U32) -> State & List<&2, U32>:
  match ok:
    case False{}:
      (state, [8, 2])
    case True{}:
      (state, page_reply(id, offset, total, Pages.take(U32.to_nat(max), Pages.drop(U32.to_nat(offset), items))))

def page_found(same: Bool, state: State, id: U32, +offset: U32, +max: U32, +items: List<&2, U32>) -> State & List<&2, U32>:
  match same:
    case False{}:
      (state, [8, 1])
    case True{}:
      +total = Pages.length(items)
      paged(U32.is_le(offset, total), state, id, offset, total, items, max)

def page(+state: State, id: U32, offset: U32, max: U32) -> State & List<&2, U32>:
  match state:
    case State{s, next, None{}}:
      (state, [8, 1])
    case State{s, next, Some{Snapshot{+held, items}}}:
      page_found(U32.is_eq(id, held), state, held, offset, max, items)

def released(same: Bool, s: Core.Simulation, next: U32, snapshot: Maybe<&2, Snapshot>) -> State & List<&2, U32>:
  match same:
    case False{}:
      (State{s, next, snapshot}, [8, 1])
    case True{}:
      (State{s, next, None{}}, [5])

def release(state: State, id: U32) -> State & List<&2, U32>:
  match state:
    case State{s, next, None{}}:
      (State{s, next, None{}}, [8, 1])
    case State{s, next, +snapshot}:
      match snapshot:
        case Some{Snapshot{held, items}}:
          released(U32.is_eq(id, held), s, next, snapshot)

def advance_state(s: Core.Simulation, +steps: U32, next: U32, snapshot: Maybe<&2, Snapshot>) -> State & List<&2, U32>:
  match s:
    case Core.Simulation{+tick, position, velocity, running, closed}:
      advanced(Budget.allowed(Budget.plan(Nat.sub(10000n, U32.to_nat(tick)), U32.to_nat(steps))), steps, s, next, snapshot)

def render_free(~render: Nat -> U32 -> U32 -> U32 -> U32 -> U32 -> Image, ok: Bool, +s: Core.Simulation, +next: U32, +depth: U32) -> State & List<&2, U32>:
  match ok:
    case False{}:
      (State{s, next, None{}}, [8, 3])
    case True{}:
      match s:
        case Core.Simulation{tick, position, velocity, running, closed}:
          capture(True{}, s, next, Core.pixels(render(U32.to_nat(depth), 0, 0, U32.shln(1, U32.to_nat(depth)), tick, position)))

def render_capture(~render: Nat -> U32 -> U32 -> U32 -> U32 -> U32 -> Image, s: Core.Simulation, +next: U32, +snapshot: Maybe<&2, Snapshot>, depth: U32) -> State & List<&2, U32>:
  match snapshot:
    case Some{held}:
      (State{s, next, snapshot}, [8, 0])
    case None{}:
      render_free(~render, U32.is_lt(next, 4294967295), s, next, depth)

def samples_free(~samples: Nat -> U32 -> U32 -> U32 -> List<&2, U32>, ok: Bool, +s: Core.Simulation, next: U32, count: U32) -> State & List<&2, U32>:
  match ok:
    case False{}:
      (State{s, next, None{}}, [8, 3])
    case True{}:
      match s:
        case Core.Simulation{tick, position, velocity, running, closed}:
          capture(True{}, s, next, samples(9n, 0, count, position))

def samples_capture(~samples: Nat -> U32 -> U32 -> U32 -> List<&2, U32>, s: Core.Simulation, +next: U32, +snapshot: Maybe<&2, Snapshot>, count: U32) -> State & List<&2, U32>:
  match snapshot:
    case Some{held}:
      (State{s, next, snapshot}, [8, 0])
    case None{}:
      samples_free(~samples, U32.is_lt(next, 4294967295), s, next, count)

def pure(~sum: Core.Tree -> U32, ~sort: Core.Tree -> List<&2, U32>, ~render: Nat -> U32 -> U32 -> U32 -> U32 -> U32 -> Image, ~samples: Nat -> U32 -> U32 -> U32 -> List<&2, U32>, state: State, command: Command) -> State & List<&2, U32>:
  match state:
    case State{+s, +next, +snapshot}:
      match command:
        case Sum{items}:
          (State{s, next, snapshot}, encode_u32(0, sum(Core.tree(5n, items))))
        case Sort{items}:
          (State{s, next, snapshot}, 3 <> Bytes.encode_u32s(sort(Core.tree(5n, items))))
        case Frame{}:
          (State{s, next, snapshot}, 2 <> Bytes.encode_u32s(Core.pixels(Qua{Pix{1}, Pix{2}, Pix{3}, Pix{4}})))
        case Inspect{}:
          observed(s, next, snapshot)
        case Reset{}:
          observed(Core.reset(s), next, snapshot)
        case Advance{+steps}:
          advance_state(s, steps, next, snapshot)
        case ApplyEvent{e}:
          observed(Core.event(e, s), next, snapshot)
        case Render{+depth}:
          render_capture(~render, s, next, snapshot, depth)
        case Samples{count}:
          samples_capture(~samples, s, next, snapshot, count)
        case Page{id, offset, max}:
          page(State{s, next, snapshot}, id, offset, max)
        case Release{id}:
          release(State{s, next, snapshot}, id)
        case Threads{}:
          (State{s, next, snapshot}, [255])

def step(~sum: Core.Tree -> U32, ~sort: Core.Tree -> List<&2, U32>, ~render: Nat -> U32 -> U32 -> U32 -> U32 -> U32 -> Image, ~samples: Nat -> U32 -> U32 -> U32 -> List<&2, U32>, state: State, command: Command) -> IO(State & List<&2, U32>):
  match command:
    case Threads{}:
      do IO<State & List<&2, U32>>:
        n : U32 <- IO.thread_count()
        return (state, encode_u32(1, n))
    case other:
      IO.pure(State & List<&2, U32>, pure(~sum, ~sort, ~render, ~samples, state, other))

def finish_items(ok: Bool, sort: Bool, +items: List<&2, U32>) -> Maybe<&2, Command>:
  match ok:
    case False{}:
      None{}
    case True{}:
      Some{Bool.pick(Command, sort, Sort{items}, Sum{items})}

def take_items(sort: Bool, got: Maybe<&2, Bytes.SplitU32s>) -> Maybe<&2, Command>:
  match got:
    case None{}:
      None{}
    case Some{Bytes.SplitU32s{items, more}}:
      finish_items(Bytes.finished(more), sort, items)

def word(a: U32, b: U32, c: U32, d: U32) -> U32:
  (((a << 24n : U32) .|. (b << 16n : U32) .|. (c << 8n : U32) .|. d : U32))

def bounded(ok: Bool, command: Command) -> Maybe<&2, Command>:
  match ok:
    case False{}:
      None{}
    case True{}:
      Some{command}

def number(tag: U32, +n: U32) -> Maybe<&2, Command>:
  match tag:
    case 4:
      bounded(U32.is_le(n, 1024), Advance{n})
    case 8:
      bounded(U32.is_le(n, 4), Render{n})
    case 9:
      bounded(U32.is_le(n, 512), Samples{n})
    case other:
      None{}

def key_command(code: U32, down: Maybe<&2, Bool>) -> Maybe<&2, Command>:
  match down:
    case None{}:
      None{}
    case Some{on}:
      Some{ApplyEvent{Key{code, on}}}

def focus_command(on: Maybe<&2, Bool>) -> Maybe<&2, Command>:
  match on:
    case None{}:
      None{}
    case Some{value}:
      Some{ApplyEvent{Focus{value}}}

def page_command(request: Maybe<&2, Pages.Request>) -> Maybe<&2, Command>:
  match request:
    case None{}:
      None{}
    case Some{Pages.Page{token, offset, max}}:
      Some{Page{token, offset, max}}
    case Some{Pages.Release{token}}:
      Some{Release{token}}

def take_command(payload: List<&2, U32>) -> Maybe<&2, Command>:
  match payload:
    case 0 <> rest:
      take_items(False{}, Bytes.take_u32s(32, rest))
    case [1]:
      Some{Threads{}}
    case [2]:
      Some{Frame{}}
    case 3 <> rest:
      take_items(True{}, Bytes.take_u32s(32, rest))
    case [5]:
      Some{Inspect{}}
    case [6]:
      Some{Reset{}}
    case [7, 0, a, b, c, d, on]:
      key_command(word(a, b, c, d), Bytes.u8_bool(on))
    case [7, 1, on]:
      focus_command(Bytes.u8_bool(on))
    case [7, 2]:
      Some{ApplyEvent{Close{}}}
    case 10 <> rest:
      page_command(Pages.parse_page(32, rest))
    case 11 <> rest:
      page_command(Pages.parse_release(rest))
    case [tag, a, b, c, d]:
      number(tag, word(a, b, c, d))
    case other:
      None{}
