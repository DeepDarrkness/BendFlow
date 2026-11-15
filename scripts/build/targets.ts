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

export const compilerCheckTargets = [
  { input: projectPath('tests/fixtures/phase2/numeric-positive.bend'), gate: '--check-only' },
  { input: projectPath('tests/fixtures/collection-file/positive.bend'), gate: '--check-only' },
  { input: projectPath('tests/fixtures/phase2/task-resource-positive.bend'), gate: '--check-only' },
  { input: projectPath('bend/compute-proof.bend'), gate: '--verdict' },
  { input: projectPath('bend/numeric-proof.bend'), gate: '--verdict' },
];
