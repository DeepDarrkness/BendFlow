# BendFlow

BendFlow wraps persistent native BendRT processes with Node.js. Phase 1 implements framed TCP exchange and process ownership. Phase 2 adds typed HTTP sessions for numeric, collection, file, network, task, process, compute, and custom-effect workers.

## Run a native round trip

Use Node 24 LTS, Git, and Clang 14 or newer. The integration suite requires Linux for `SIGSTOP` and process-cleanup checks.

1. Install the project dependencies, including the pinned Bun compiler host:

   ```sh
   npm ci
   ```

2. Fetch the reviewed Bend revision:

   ```sh
   npm run setup:bend
   ```

3. If Clang is missing on Ubuntu 24.04 x64, extract the pinned Ubuntu packages without root access:

   ```sh
   npm run setup:clang
   ```

   On other systems, install Clang 14 or newer. Set `CC` to select a specific Clang executable.

4. Check the TypeScript code and run the native suite:

   ```sh
   npm run typecheck
   npm test
   ```

   The suite checks and compiles Bend fixtures once, runs the minimal executable, and records versions in `build/toolchain.json`. Missing prerequisites fail the suite.

5. Run the example:

   ```sh
   npm run example
   ```

   Each output line contains the worker PID, sent bytes, and received bytes. All lines have the same PID and matching byte arrays.

See [the Phase 1 protocol reference](docs/phase1-protocol.md) for message encodings and lifecycle behavior.

## Use typed application sessions

After building the workers with `npm run build:native`, create a gateway and a typed client:

```ts
import { startAppGateway } from './src/gateway.ts';
import { createAppClient } from './src/client.ts';

const gateway = await startAppGateway();
try {
	const client = createAppClient(gateway.url);
	const { sessionId } = await client.sessions.create({ kind: 'numeric' });
	const reply = await client.numeric.command({
		sessionId, command: { kind: 'add', amount: 7 },
	});
	console.log(reply);
	await client.sessions.close({ sessionId });
} finally {
	await gateway.close();
}
```

The reply has `kind: 'value'` and a total of `7`. Other session kinds use the same lifecycle and their own typed command routes. Multiple clients can use one session ID. Each created session owns one native process, and the gateway admits at most 16 live or starting sessions by default.

Use `createAppClient` for byte-valued commands and replies. It configures the bounded oRPC byte serializer and validates replies against the contracts. `GET /capabilities` lists the session kinds and available CPU profiles. GPU and graphics/audio profiles currently return `unavailable` with a reason.

See [the Phase 2 protocol reference](docs/phase2-protocol.md) for route names, limits, and cleanup behavior. The [Phase 2 status](docs/bend-node-phase2.md) and [completion plan](docs/bend-node-phase2-completion-plan.md) describe the remaining conformance work.

## Inspect conformance results

Run `npm test` to rebuild native workers, run both phases, and write `build/phase2-results.json`. The report links each verified feature to executed tests and records the compiler revision and execution profiles.

The required feature IDs live in `scripts/phase2-requirements.ts`. Their status and test references live in `tests/phase2/coverage.json`. Deleting an unfinished inventory row fails validation. A missing, failed, or skipped referenced test fails a verified claim. Pending requirements keep the report's completion status at `in-progress`.
