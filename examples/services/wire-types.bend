import Base

type Box<-A: Data> is Data:
  Box{value: A}

type EmptyRecord is Data:
  EmptyRecord{}

type Choice is Data:
  Absent{}
  Present{kind: U32, text: String}

type Packet is Data:
  Packet{enabled: Bool, count: Nat, ratio: F32, title: String, numbers: List<&2, U32>, choice: Choice, box: Box<Box<U32>>, empty: EmptyRecord}

def api.hidden(value: U32) -> U32:
  value
