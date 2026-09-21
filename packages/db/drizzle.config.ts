import { defineConfig } from "drizzle-kit";

// Used by `pnpm --filter @skillcdn/db run generate` only. Generating needs no database.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./migrations",
  casing: "snake_case",
});
