import Base

def bad(n: Nat) -> Nat:
  match Nat.add(n, 1n):
    case 0n:
      0n
    case other:
      other
