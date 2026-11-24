import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The tests read directories, serve them and run the command, so how long one takes depends
    // on the machine and on what runs beside it: under `pnpm check`, beside the integration
    // tests, the first test of a file comes close to the default five seconds.
    testTimeout: 30_000,
  },
});
