export const phase2Requirements = {
  numeric: ['persistence', 'overflow', 'parse-compare-bits-float', 'reset', 'full-operation-set', 'native-boundaries'],
  collection: ['maps', 'lists-arrays', 'isolation', 'nested-records-tuples', 'sets-folds', 'templates-polymorphism', 'affine-closures', 'dependent-structures', 'monads', 'boundaries'],
  file: ['persistence', 'failure-retains-handle', 'offsets', 'exclusive-create', 'raw-read-bounds', 'append-eof-text', 'resource-isolation'],
  network: ['tcp-exchange', 'udp-exchange', 'explicit-shutdown', 'listeners-polling', 'controlled-fragmentation', 'backpressure-failures', 'udp-boundaries'],
  task: ['fork-join', 'non-cancelling-timeout', 'nap', 'channels-spawn', 'resource-transfer', 'lifecycle-boundaries'],
  process: ['environment-arguments', 'exit-streams', 'output-bounds', 'random', 'full-fixture'],
  compute: ['cpu-baseline', 'four-thread-baseline', 'balanced-sum-sort', 'simulation-events-rendering', 'samples'],
  custom: ['marker', 'execution-paths', 'failure-persistence'],
  protocol: ['validation', 'strict-unicode', 'binary-http', 'full-codec-vectors', 'nested-encodings', 'paging'],
  gateway: ['numeric', 'collection', 'file', 'network', 'task', 'process', 'compute', 'custom', 'validation-isolation-admission', 'effectful-no-replay', 'effect-families'],
  compiler: ['affine-state', 'computed-match', 'termination', 'erasure', 'codec-positive', 'affine-resources', 'templates-dependent-inputs', 'laws-verdict'],
  hardware: ['gpu', 'window', 'audio'],
} as const;

export const requiredFeatureIds = Object.entries(phase2Requirements).flatMap(([group, names]) => names.map(name => `${group}.${name}`));
