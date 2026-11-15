import Base
import ../../../bend/collection-features.bend as Features
import ../../../bend/pages.bend as Pages

def transfer(file: File) -> File:
  file

def array_use(got: Array<U32> & U32) -> U32:
  (array, value) = got
  value

def main() -> List<&2, U32>:
  array = Array.new(U32, 2n, 0)
  edited = Array.set(U32, array, 7, 42)
  once = Features.adder(2)
  [array_use(Array.get(U32, edited, 3)), once(40), Features.first(1n, (42, (43, Unit{}))), Features.twice(~Features.inc, 40), Features.identity(U32, 42)]
