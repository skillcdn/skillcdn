import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Integration tests create and migrate a database per file.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
