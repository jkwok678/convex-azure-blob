import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "edge-runtime",
    // Integration tests need a running Azurite: see vitest.integration.config.js.
    exclude: [...configDefaults.exclude, "**/*.integration.test.ts"],
    typecheck: {
      tsconfig: "./tsconfig.test.json",
    },
  },
});
