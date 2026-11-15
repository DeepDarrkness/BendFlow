import Base
import ./bytes.bend as Bytes
import ./loop.bend as Loop
import ./pages.bend as Pages

type State is Type:
  Files{next: U32, open: Map<&1, File>}
  Retained{core: State, snapshot: Pages.Snapshot}

type Command is Data:
  Open{path: String, mode: String}
  Write{id: U32, bytes: List<&2, U32>}
  Read{id: U32, max: U32}
  Size{id: U32}
  ReadAt{id: U32, offset: U32, max: U32}
  WriteAt{id: U32, offset: U32, bytes: List<&2, U32>}
  Drop{id: U32}
  Capture{id: U32}
  Paging{request: Pages.Request}

def initial() -> State:
  Retained{Files{1, Map.new(&1, File)}, Pages.initial()}

def encode_fail(error: U32 & String) -> List<&2, U32>:
  Bytes.encode_error(error)

def encode_id(id: U32) -> List<&2, U32>:
  0 <> Bytes.encode_u32(id)

def encode_bytes(bytes: List<&2, U32>) -> List<&2, U32>:
  1 <> Bytes.encode_len_bytes(bytes)

def encode_size(n: U32) -> List<&2, U32>:
  4 <> Bytes.encode_u32(n)

def missing() -> List<&2, U32>:
  [3]

def opened_ok(+id: U32, next: U32, open: Map<&1, File>, file: File) -> State & List<&2, U32>:
  (Files{next, Map.set(&1, File, open, Bytes.id_key(id), file)}, encode_id(id))

def opened(+next: U32, open: Map<&1, File>, result: Result<&1, &1, U32 & String, File>) -> State & List<&2, U32>:
  match result:
    case Fail{error}:
      (Files{next, open}, encode_fail(error))
    case Done{file}:
      +id = next
      opened_ok(id, (id + 1 : U32), open, file)

def after_bytes(+next: U32, +id: U32, open: Map<&1, File>, got: File & Result<&1, &1, U32 & String, List<&2, U32>>) -> State & List<&2, U32>:
  (file, result) = got
  match result:
    case Fail{error}:
      (Files{next, Map.set(&1, File, open, Bytes.id_key(id), file)}, encode_fail(error))
    case Done{bytes}:
      (Files{next, Map.set(&1, File, open, Bytes.id_key(id), file)}, encode_bytes(bytes))

def after_unit(+next: U32, +id: U32, open: Map<&1, File>, got: File & Result<&1, &1, U32 & String, Unit>) -> State & List<&2, U32>:
  (file, result) = got
  match result:
    case Fail{error}:
      (Files{next, Map.set(&1, File, open, Bytes.id_key(id), file)}, encode_fail(error))
    case Done{u}:
      (Files{next, Map.set(&1, File, open, Bytes.id_key(id), file)}, Loop.ok())

def after_size(+next: U32, +id: U32, open: Map<&1, File>, got: File & Result<&1, &1, U32 & String, U32>) -> State & List<&2, U32>:
  (file, result) = got
  match result:
    case Fail{error}:
      (Files{next, Map.set(&1, File, open, Bytes.id_key(id), file)}, encode_fail(error))
    case Done{n}:
      (Files{next, Map.set(&1, File, open, Bytes.id_key(id), file)}, encode_size(n))

def with_file_bytes(+next: U32, +id: U32, max: U32, got: Map<&1, File> & Maybe<&1, File>) -> IO(State & List<&2, U32>):
  (open, file) = got
  match file:
    case None{}:
      IO.pure(State & List<&2, U32>, (Files{next, open}, missing()))
    case Some{h}:
      do IO<State & List<&2, U32>>:
        result : File & Result<&1, &1, U32 & String, List<&2, U32>> <- File.read_bytes(h, max)
        return after_bytes(next, id, open, result)

def with_file_write(+next: U32, +id: U32, bytes: List<&2, U32>, got: Map<&1, File> & Maybe<&1, File>) -> IO(State & List<&2, U32>):
  (open, file) = got
  match file:
    case None{}:
      IO.pure(State & List<&2, U32>, (Files{next, open}, missing()))
    case Some{h}:
      do IO<State & List<&2, U32>>:
        result : File & Result<&1, &1, U32 & String, Unit> <- File.write_bytes(h, bytes)
        return after_unit(next, id, open, result)

def with_file_size(+next: U32, +id: U32, got: Map<&1, File> & Maybe<&1, File>) -> IO(State & List<&2, U32>):
  (open, file) = got
  match file:
    case None{}:
      IO.pure(State & List<&2, U32>, (Files{next, open}, missing()))
    case Some{h}:
      do IO<State & List<&2, U32>>:
        result : File & Result<&1, &1, U32 & String, U32> <- File.size(h)
        return after_size(next, id, open, result)

def with_file_read_at(+next: U32, +id: U32, offset: U32, max: U32, got: Map<&1, File> & Maybe<&1, File>) -> IO(State & List<&2, U32>):
  (open, file) = got
  match file:
    case None{}:
      IO.pure(State & List<&2, U32>, (Files{next, open}, missing()))
    case Some{h}:
      do IO<State & List<&2, U32>>:
        result : File & Result<&1, &1, U32 & String, List<&2, U32>> <- File.read_at(h, offset, max)
        return after_bytes(next, id, open, result)

def with_file_write_at(+next: U32, +id: U32, offset: U32, bytes: List<&2, U32>, got: Map<&1, File> & Maybe<&1, File>) -> IO(State & List<&2, U32>):
  (open, file) = got
  match file:
    case None{}:
      IO.pure(State & List<&2, U32>, (Files{next, open}, missing()))
    case Some{h}:
      do IO<State & List<&2, U32>>:
        result : File & Result<&1, &1, U32 & String, Unit> <- File.write_at(h, offset, bytes)
        return after_unit(next, id, open, result)

def with_file_close(+next: U32, got: Map<&1, File> & Maybe<&1, File>) -> IO(State & List<&2, U32>):
  (open, file) = got
  match file:
    case None{}:
      IO.pure(State & List<&2, U32>, (Files{next, open}, missing()))
    case Some{h}:
      do IO<State & List<&2, U32>>:
        Unit <- File.close(h)
        return (Files{next, open}, Loop.ok())

def open_allowed(ok: Bool, +next: U32, open: Map<&1, File>, path: String, mode: String) -> IO(State & List<&2, U32>):
  match ok:
    case False{}:
      IO.pure(State & List<&2, U32>, (Files{next, open}, [11]))
    case True{}:
      do IO<State & List<&2, U32>>:
        result : Result<&1, &1, U32 & String, File> <- File.open(path, mode)
        return opened(next, open, result)

def core_step(state: State, command: Command) -> IO(State & List<&2, U32>):
  match state command:
    case Files{+next, open} Open{path, mode}:
      open_allowed(U32.is_le(next, 64), next, open, path, mode)
    case Files{+next, open} Write{+id, bytes}:
      with_file_write(next, id, bytes, Map.pop(&1, File, open, Bytes.id_key(id)))
    case Files{+next, open} Read{+id, max}:
      with_file_bytes(next, id, max, Map.pop(&1, File, open, Bytes.id_key(id)))
    case Files{+next, open} Size{+id}:
      with_file_size(next, id, Map.pop(&1, File, open, Bytes.id_key(id)))
    case Files{+next, open} ReadAt{+id, offset, max}:
      with_file_read_at(next, id, offset, max, Map.pop(&1, File, open, Bytes.id_key(id)))
    case Files{+next, open} WriteAt{+id, offset, bytes}:
      with_file_write_at(next, id, offset, bytes, Map.pop(&1, File, open, Bytes.id_key(id)))
    case Files{+next, open} Drop{id}:
      with_file_close(next, Map.pop(&1, File, open, Bytes.id_key(id)))
    case other command:
      IO.pure(State & List<&2, U32>, (other, [255]))

def restore(snapshot: Pages.Snapshot, got: State & List<&2, U32>) -> State & List<&2, U32>:
  (core, reply) = got
  (Retained{core, snapshot}, reply)

def restored(core: State, got: Pages.Snapshot & List<&2, U32>) -> State & List<&2, U32>:
  (snapshot, reply) = got
  (Retained{core, snapshot}, reply)

def capture_bounded(ok: Bool, core: State, snapshot: Pages.Snapshot, bytes: List<&2, U32>) -> State & List<&2, U32>:
  match ok:
    case False{}:
      (Retained{core, snapshot}, [10])
    case True{}:
      restored(core, Pages.capture(snapshot, bytes))

def capture_bytes(+next: U32, +id: U32, open: Map<&1, File>, snapshot: Pages.Snapshot, got: File & Result<&1, &1, U32 & String, List<&2, U32>>) -> State & List<&2, U32>:
  (file, result) = got
  match result:
    case Fail{error}:
      (Retained{Files{next, Map.set(&1, File, open, Bytes.id_key(id), file)}, snapshot}, encode_fail(error))
    case Done{+bytes}:
      capture_bounded(U32.is_le(Pages.length(bytes), 65536), Files{next, Map.set(&1, File, open, Bytes.id_key(id), file)}, snapshot, bytes)

def capture_file(+next: U32, +id: U32, snapshot: Pages.Snapshot, got: Map<&1, File> & Maybe<&1, File>) -> IO(State & List<&2, U32>):
  (open, file) = got
  match file:
    case None{}:
      IO.pure(State & List<&2, U32>, (Retained{Files{next, open}, snapshot}, missing()))
    case Some{h}:
      do IO<State & List<&2, U32>>:
        result : File & Result<&1, &1, U32 & String, List<&2, U32>> <- File.read_at(h, 0, 65537)
        return capture_bytes(next, id, open, snapshot, result)

def step(state: State, command: Command) -> IO(State & List<&2, U32>):
  match state command:
    case Retained{Files{+next, open}, snapshot} Capture{+id}:
      capture_file(next, id, snapshot, Map.pop(&1, File, open, Bytes.id_key(id)))
    case Retained{core, snapshot} Paging{Pages.Page{token, offset, max}}:
      IO.pure(State & List<&2, U32>, restored(core, Pages.page(~(xs => Bytes.encode_len_bytes(xs)), snapshot, token, offset, max)))
    case Retained{core, snapshot} Paging{Pages.Release{token}}:
      IO.pure(State & List<&2, U32>, restored(core, Pages.release(snapshot, token)))
    case Retained{core, snapshot} command:
      do IO<State & List<&2, U32>>:
        result : State & List<&2, U32> <- core_step(core, command)
        return restore(snapshot, result)
    case core command:
      core_step(core, command)

def finish_open(ok: Bool, path: String, mode: String) -> Maybe<&2, Command>:
  match ok:
    case True{}:
      Some{Open{path, mode}}
    case False{}:
      None{}

def no_nul(path: String) -> Bool:
  match path:
    case SNil{}:
      True{}
    case SCon{Chr{value}, tail}:
      Bool.and(U32.is_ne(value, 0), no_nul(tail))

def valid_mode(+mode: String) -> Bool:
  Bool.or(String.eq(mode, "r"), Bool.or(String.eq(mode, "r+"), Bool.or(String.eq(mode, "w"), Bool.or(String.eq(mode, "a"), String.eq(mode, "x")))))

def take_open_mode(+path: String, got: Maybe<&2, Bytes.SplitText>) -> Maybe<&2, Command>:
  match got:
    case None{}:
      None{}
    case Some{Bytes.SplitText{+mode, more}}:
      finish_open(Bool.and(Bytes.finished(more), Bool.and(valid_mode(mode), Bool.and(Bool.not(String.is_empty(path)), no_nul(path)))), path, mode)

def take_open(got: Maybe<&2, Bytes.SplitText>) -> Maybe<&2, Command>:
  match got:
    case None{}:
      None{}
    case Some{Bytes.SplitText{path, rest}}:
      take_open_mode(path, Bytes.take_text(8, rest))

def finish_write.valid(ok: Bool, id: U32, bytes: List<&2, U32>) -> Maybe<&2, Command>:
  match ok:
    case True{}:
      Some{Write{id, bytes}}
    case False{}:
      None{}

def finish_write(ok: Bool, +id: U32, bytes: List<&2, U32>) -> Maybe<&2, Command>:
  finish_write.valid(Bool.and(ok, U32.is_ne(id, 0)), id, bytes)

def take_write_bytes(id: U32, got: Maybe<&2, Bytes.SplitBytes>) -> Maybe<&2, Command>:
  match got:
    case None{}:
      None{}
    case Some{Bytes.SplitBytes{bytes, more}}:
      finish_write(Bytes.finished(more), id, bytes)

def take_write(got: Maybe<&2, Bytes.SplitU32>) -> Maybe<&2, Command>:
  match got:
    case None{}:
      None{}
    case Some{Bytes.SplitU32{id, rest}}:
      take_write_bytes(id, Bytes.take_len_bytes(192, rest))

def finish_read.valid(ok: Bool, id: U32, max: U32) -> Maybe<&2, Command>:
  match ok:
    case True{}:
      Some{Read{id, max}}
    case False{}:
      None{}

def finish_read(ok: Bool, +id: U32, max: U32) -> Maybe<&2, Command>:
  finish_read.valid(Bool.and(ok, U32.is_ne(id, 0)), id, max)

def take_read_max(id: U32, got: Maybe<&2, Bytes.SplitU32>) -> Maybe<&2, Command>:
  match got:
    case None{}:
      None{}
    case Some{Bytes.SplitU32{+max, more}}:
      finish_read(Bool.and(Bytes.finished(more), U32.is_le(max, 192)), id, max)

def take_read(got: Maybe<&2, Bytes.SplitU32>) -> Maybe<&2, Command>:
  match got:
    case None{}:
      None{}
    case Some{Bytes.SplitU32{id, rest}}:
      take_read_max(id, Bytes.take_u32(rest))

def finish_size.valid(ok: Bool, id: U32) -> Maybe<&2, Command>:
  match ok:
    case True{}:
      Some{Size{id}}
    case False{}:
      None{}

def finish_size(ok: Bool, +id: U32) -> Maybe<&2, Command>:
  finish_size.valid(Bool.and(ok, U32.is_ne(id, 0)), id)

def take_size(got: Maybe<&2, Bytes.SplitU32>) -> Maybe<&2, Command>:
  match got:
    case None{}:
      None{}
    case Some{Bytes.SplitU32{id, more}}:
      finish_size(Bytes.finished(more), id)

def finish_read_at.valid(ok: Bool, id: U32, offset: U32, max: U32) -> Maybe<&2, Command>:
  match ok:
    case True{}:
      Some{ReadAt{id, offset, max}}
    case False{}:
      None{}

def finish_read_at(ok: Bool, +id: U32, offset: U32, max: U32) -> Maybe<&2, Command>:
  finish_read_at.valid(Bool.and(ok, U32.is_ne(id, 0)), id, offset, max)

def take_read_at_max(id: U32, offset: U32, got: Maybe<&2, Bytes.SplitU32>) -> Maybe<&2, Command>:
  match got:
    case None{}:
      None{}
    case Some{Bytes.SplitU32{+max, more}}:
      finish_read_at(Bool.and(Bytes.finished(more), U32.is_le(max, 192)), id, offset, max)

def take_read_at_off(id: U32, got: Maybe<&2, Bytes.SplitU32>) -> Maybe<&2, Command>:
  match got:
    case None{}:
      None{}
    case Some{Bytes.SplitU32{offset, rest}}:
      take_read_at_max(id, offset, Bytes.take_u32(rest))

def take_read_at(got: Maybe<&2, Bytes.SplitU32>) -> Maybe<&2, Command>:
  match got:
    case None{}:
      None{}
    case Some{Bytes.SplitU32{id, rest}}:
      take_read_at_off(id, Bytes.take_u32(rest))

def finish_write_at.valid(ok: Bool, id: U32, offset: U32, bytes: List<&2, U32>) -> Maybe<&2, Command>:
  match ok:
    case True{}:
      Some{WriteAt{id, offset, bytes}}
    case False{}:
      None{}

def finish_write_at(ok: Bool, +id: U32, offset: U32, bytes: List<&2, U32>) -> Maybe<&2, Command>:
  finish_write_at.valid(Bool.and(ok, U32.is_ne(id, 0)), id, offset, bytes)

def take_write_at_bytes(id: U32, offset: U32, got: Maybe<&2, Bytes.SplitBytes>) -> Maybe<&2, Command>:
  match got:
    case None{}:
      None{}
    case Some{Bytes.SplitBytes{bytes, more}}:
      finish_write_at(Bytes.finished(more), id, offset, bytes)

def take_write_at_off(id: U32, got: Maybe<&2, Bytes.SplitU32>) -> Maybe<&2, Command>:
  match got:
    case None{}:
      None{}
    case Some{Bytes.SplitU32{offset, rest}}:
      take_write_at_bytes(id, offset, Bytes.take_len_bytes(192, rest))

def take_write_at(got: Maybe<&2, Bytes.SplitU32>) -> Maybe<&2, Command>:
  match got:
    case None{}:
      None{}
    case Some{Bytes.SplitU32{id, rest}}:
      take_write_at_off(id, Bytes.take_u32(rest))

def finish_close.valid(ok: Bool, id: U32) -> Maybe<&2, Command>:
  match ok:
    case True{}:
      Some{Drop{id}}
    case False{}:
      None{}

def finish_close(ok: Bool, +id: U32) -> Maybe<&2, Command>:
  finish_close.valid(Bool.and(ok, U32.is_ne(id, 0)), id)

def take_close(got: Maybe<&2, Bytes.SplitU32>) -> Maybe<&2, Command>:
  match got:
    case None{}:
      None{}
    case Some{Bytes.SplitU32{id, more}}:
      finish_close(Bytes.finished(more), id)

def take_capture(got: Maybe<&2, Bytes.SplitU32>) -> Maybe<&2, Command>:
  match got:
    case None{}:
      None{}
    case Some{Bytes.SplitU32{+id, more}}:
      do Maybe<&2, Command>:
        valid : Unit <- Pages.valid_unit(Bool.and(Bytes.finished(more), U32.is_ne(id, 0)))
        return Capture{id}

def take_paging(got: Maybe<&2, Pages.Request>) -> Maybe<&2, Command>:
  do Maybe<&2, Command>:
    request : Pages.Request <- got
    return Paging{request}

def take_command(payload: List<&2, U32>) -> Maybe<&2, Command>:
  match payload:
    case 0 <> rest:
      take_open(Bytes.take_text(96, rest))
    case 1 <> rest:
      take_write(Bytes.take_u32(rest))
    case 2 <> rest:
      take_read(Bytes.take_u32(rest))
    case 3 <> rest:
      take_size(Bytes.take_u32(rest))
    case 4 <> rest:
      take_read_at(Bytes.take_u32(rest))
    case 5 <> rest:
      take_write_at(Bytes.take_u32(rest))
    case 6 <> rest:
      take_close(Bytes.take_u32(rest))
    case 7 <> rest:
      take_capture(Bytes.take_u32(rest))
    case 8 <> rest:
      take_paging(Pages.parse_page(192, rest))
    case 9 <> rest:
      take_paging(Pages.parse_release(rest))
    case other:
      None{}

def close_list(files: List<&1, File>) -> IO(Unit):
  match files:
    case Nil{}:
      IO.pure(Unit, Unit{})
    case h <> t:
      do IO<Unit>:
        Unit <- File.close(h)
        close_list(t)

def shutdown(state: State) -> IO(Unit):
  match state:
    case Files{next, open}:
      close_list(Map.values(&1, File, open))
    case Retained{core, snapshot}:
      shutdown(core)
