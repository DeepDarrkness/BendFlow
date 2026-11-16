import Base
import ./wire-types.bend as Types

def api.add(a: U32, b: U32) -> U32:
  (a + b : U32)

def api.answer() -> U32:
  42

def api.unit(value: Unit) -> Unit:
  value

def api.pair(value: U32 & Bool) -> U32 & Bool:
  value

def api.packet(value: Types.Packet) -> Types.Packet:
  value

def api.nested(value: List<&2, List<&2, U32>>) -> List<&2, List<&2, U32>>:
  value

def api.units(value: List<&2, Unit>) -> List<&2, Unit>:
  value

def api.greet(name: String) -> IO(String):
  IO.pure(String, "Hello, " ++ name)

def api.nat(value: Nat) -> Nat:
  value

def api.float(value: F32) -> F32:
  value

def api.float_add(a: F32, b: F32) -> F32:
  (a + b : F32)

type Outcome is Data:
  Good{value: U32}
  Bad{code: U32}

def divide(zero: Bool, a: U32, b: U32) -> Outcome:
  match zero:
    case True{}:
      Bad{1}
    case False{}:
      Good{(a / b : U32)}

def divide_inputs(a: U32, +b: U32) -> Outcome:
  divide(U32.is_eq(b, 0), a, b)

def api.divide(a: U32, b: U32) -> Outcome:
  divide_inputs(a, b)

def api.overflow_nat() -> Nat:
  Nat.mul(65536n, Nat.add(U32.to_nat(4294967295), 1n))

def api.overflow_text() -> String:
  "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"

def api.overflow_list() -> List<&2, Unit>:
  [Unit{}, Unit{}, Unit{}, Unit{}, Unit{}]

type Store is Type:
  Store{values: Array<U32>, keys: Map<&2, U32>}

type StoreReply is Data:
  StoreReply{cell: U32, last: U32}

def lifecycle.init.store() -> IO(Store):
  IO.pure(Store, Store{[0 : U32*8n], Map.new(&2, U32)})

def lifecycle.finalize.store(state: Store) -> IO(Unit):
  IO.print("store finalized")

def store_array(got: Array<U32> & U32, keys: Map<&2, U32>, last: U32) -> IO(Store & StoreReply):
  (values, cell) = got
  IO.pure(Store & StoreReply, (Store{values, keys}, StoreReply{cell, last}))

def store_got(got: Map<&2, U32> & U32, values: Array<U32>, index: U32) -> IO(Store & StoreReply):
  (keys, result) = got
  store_array(Array.get(U32, values, index), keys, result)

def store_step(state: Store, +index: U32, value: U32, write: Bool) -> IO(Store & StoreReply):
  match state write:
    case Store{values, keys} True{}:
      +v = value
      values[index] <- v
      keys = Map.set(&2, U32, keys, "last", v)
      store_got(Map.get(U32, 0, keys, "last"), values, index)
    case Store{values, keys} False{}:
      store_got(Map.get(U32, 0, keys, "last"), values, index)

def api.store(state: Store, index: U32, value: U32, write: Bool) -> IO(Store & StoreReply):
  store_step(state, index, value, write)

def pow2(+n: Nat) -> U32:
  match n:
    case 0n:
      1
    case 1n+p:
      a b = pow2(p) pow2(p)
      (a + b : U32)

def api.fork() -> U32:
  pow2(12n)

law add_zero:
  for x: Nat
  {Nat.add(x, 0n) == x : Nat}

def add_zero(x):
  match x:
    case 0n:
      {==}
    case 1n+p:
      %add_zero(p) : {1n+Nat.add(p, 0n) == 1n+_ : Nat}
      {==}

def api.proved(value: Nat) -> Nat:
  -proof = add_zero(value)
  value
