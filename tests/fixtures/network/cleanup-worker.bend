import Base
import ./driver.bend as Driver
import ../../../bend/network-app.bend as Nets
import ../../../bend/loop.bend as Loop

def main() -> IO(Unit):
  Loop.run(~Nets.State, ~Driver.handle, ~Driver.shutdown, ~Driver.contract, ~"cleanup-worker PORT", Nets.initial())
