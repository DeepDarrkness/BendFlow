# BendFlow

BendFlow wraps a persistent native BendRT process with Node.js. Phase 1 implements framed TCP exchange and process ownership.

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

See [the Phase 1 protocol reference](docs/phase1-protocol.md) for message encodings and lifecycle behavior. The [implementation plan](bend-node-phase1.md) describes the next typed oRPC slice.
