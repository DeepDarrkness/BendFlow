import Base

def loop(n: Nat) -> Nat:
  match n:
    case 0n:
      0n
    case 1n+p:
      loop(n)
