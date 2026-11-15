import Base
import ../../../bend/compute-app.bend as App
import ../../../bend/compute-core.bend as Core

def main() -> App.State & List<&2, U32>:
  App.pure(~Core.sum, ~Core.sort, ~Core.image, ~Core.buffer, App.State{Core.initial(), 4294967295, None{}}, App.Render{4})
