import { buildServices } from '../build/services.ts';
import { projectPath } from '../../src/paths.ts';

for (const example of ['counter', 'portable', 'effects']) {
  buildServices({ entry: projectPath(`examples/services/${example}.bend`),
    out: projectPath(example === 'counter' ? 'build/services' : example === 'portable' ? 'build/portable-services' : 'build/effect-services'),
    ...(example === 'portable' ? { maxText: 16, maxItems: 4 } : {}) });
}
