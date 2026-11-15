import { SESSION_KINDS } from '../../contracts/kinds.ts';
import { projectPath } from '../../src/paths.ts';

function target(input: string, name: string, checkOnly = true) {
  return { input: projectPath(input), output: projectPath('build', name), checkOnly };
}

export const nativeTargets = [
  target('tests/fixtures/minimal.bend', 'minimal'),
  target('bend/echo-worker.bend', 'echo-worker'),
  target('bend/session-worker.bend', 'session-worker'),
  target('tests/fixtures/session-cases.bend', 'session-cases'),
  target('tests/fixtures/phase2/bytes-check.bend', 'bytes-check'),
  // Custom uses a foreign effect that the pure --check-only mode cannot accept.
  ...SESSION_KINDS.map(kind => target(`bend/${kind}-worker.bend`, `${kind}-worker`, kind !== 'custom')),
];
