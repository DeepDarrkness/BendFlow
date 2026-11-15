import Base
import ./driver.bend as Driver
import ../../../bend/network-app.bend as Nets
import ../../../bend/loop.bend as Loop

def main() -> IO(Unit):
  Loop.run(~Nets.State, ~Driver.handle, ~Nets.shutdown, ~Driver.contract, ~"exhaustion-worker PORT", Nets.Nets{4294967295, Map.new(&1, Nets.Resource)})
