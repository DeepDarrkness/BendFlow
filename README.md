# BendFlow

BendFlow wraps persistent native BendRT processes with Node.js. Phase 1 implements framed TCP exchange and process ownership. Phase 2 adds typed HTTP sessions for numeric, collection, file, network, task, process, compute, and custom-effect workers.

See [the consolidated Phase 2 reference](docs/bend-node-phase2.md) for current status, verified scope, protocol details, and remaining CUDA work.

## Run a native round trip

Use Node 24 LTS, Git, Clang 14 or newer, and Lean 4.34.0 for proof checks. The integration suite requires Linux for `SIGSTOP` and process-cleanup checks.

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

4. Install the pinned Lean proof checker on Linux x64:

   ```sh
	npm run setup:lean
   ```

   Build and test scripts select the local Clang and Lean installations automatically through `PATH`. CUDA setup is separate from portable setup.

5. Check the TypeScript code and run the native suite:

   ```sh
	npm run typecheck
	npm test
   ```

   The suite checks and compiles Bend fixtures once, runs the minimal executable, and records versions in `build/toolchain.json`. Missing prerequisites fail the suite.

6. Run the example:

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

The reply has `kind: 'value'` and a total of `7`. Other session kinds use the same lifecycle and their own typed command routes. Multiple clients can use one session ID. Each created session owns one native process, and the default admission limit is 16 live, starting, or closing sessions.

Use `createAppClient` for byte-valued commands and replies. It configures the bounded oRPC byte serializer and validates replies against the contracts. `GET /capabilities` lists session kinds and execution profiles. GPU is unavailable on the current host. GPU compute sessions require current verified evidence configured through the gateway's `gpuEvidence` option or `BENDFLOW_GPU_EVIDENCE`. Rejected GPU requests spawn no worker and never fall back silently. The `graphics-audio` profile is excluded.

See [the Phase 2 reference](docs/bend-node-phase2.md#http-routes-and-execution-profiles) for routes, snapshot pages, limits, cleanup, and CUDA setup and verification.

## Inspect conformance results

Run `npm test` to rebuild native workers, run both phases, and write `build/phase2-results.json`. The report links each verified feature to executed tests and records the compiler revision and execution profiles.

The required feature IDs live in `scripts/conformance/requirements.ts`. Their status and exact test references live in `tests/conformance/coverage.json`. A missing requirement or a missing, failed, or skipped referenced test blocks verification.

Run these checks against the executed report:

```sh
	npm run check:compiler
	npm run conformance:portable
	npm run conformance:hardware
	npm run conformance:full
```

`build/phase2-results.json` is generated and ignored by Git. The [Phase 2 reference](docs/bend-node-phase2.md#reproduction-and-completion-checks) records verification commands, completion policy, and hardware requirements.
