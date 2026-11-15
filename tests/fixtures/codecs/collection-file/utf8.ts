// Literal byte sequences: lone continuation, overlong encodings, incomplete
// sequences, bad continuations, surrogate, out-of-range scalar and illegal leads.
export const malformedUtf8 = [
  '0180', '02c080', '02c181', '03e08181', '04f0808181',
  '01c2', '02e180', '03f18080', '02c241', '03e18041', '04f1808041',
  '03eda080', '04f4908080', '04f5808080', '01ff', '01fe',
];

// Every text-bearing command field gets every malformed sequence; surrounding
// fields are valid literal wire fragments, so rejection must reach that field.
export const collectionTextSlots = [
  ['00', '00'], ['0000', ''], ['01', ''], ['02', ''],
  ['0d', '0006000000000000000000000000000000000000000000000000'],
  ['0d00', '06000000000000000000000000000000000000000100000000'],
  ['0f', '0000'], ['0f00', '00'], ['0f0000', ''],
  ['1100000000', ''], ['15', '00'], ['1500', ''], ['16', '00'], ['1600', ''],
];
export const fileTextSlots = [['00', '0172'], ['000170', '']];
