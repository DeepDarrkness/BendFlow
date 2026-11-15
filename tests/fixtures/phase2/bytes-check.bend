import Base
import ../../../bend/bytes.bend as Bytes

def show_nat_rest(ok: Bool, n: Nat) -> String:
  match ok:
    case True{}:
      "nat:" ++ Nat.show(n)
    case False{}:
      "trailing"

def show_maybe_nat(got: Maybe<&2, Bytes.SplitNat>) -> String:
  match got:
    case None{}:
      "none"
    case Some{Bytes.SplitNat{n, rest}}:
      show_nat_rest(Bytes.finished(rest), n)

def show_text_rest(ok: Bool, text: String) -> String:
  match ok:
    case True{}:
      "text:" ++ text
    case False{}:
      "trailing"

def show_maybe_text(got: Maybe<&2, Bytes.SplitText>) -> String:
  match got:
    case None{}:
      "none"
    case Some{Bytes.SplitText{text, rest}}:
      show_text_rest(Bytes.finished(rest), text)

def main() -> IO(Unit):
  do IO<Unit>:
    IO.print(show_maybe_nat(Bytes.take_nat(Bytes.encode_nat(65535n))))
    IO.print(show_maybe_text(Bytes.take_text(96, Bytes.encode_text("Ae"))))
    IO.print(show_maybe_text(Bytes.take_text(96, [2, 255, 255])))
