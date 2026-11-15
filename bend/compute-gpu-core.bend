import Base
import ./compute-core.bend as Core

def sum(tree: Core.Tree) -> U32:
  Core.sum!(tree)

def sort(tree: Core.Tree) -> List<&2, U32>:
  Core.sort!(tree)

def image(depth: Nat, x: U32, y: U32, side: U32, tick: U32, position: U32) -> Image:
  Core.render!(depth, x, y, side, tick, position)

def buffer(depth: Nat, start: U32, count: U32, phase: U32) -> List<&2, U32>:
  Core.samples!(depth, start, count, phase)
