import { defineConfig } from "vitest/config";

// Runs the tests that talk to a real Azurite emulator, which
// test/azurite.setup.js starts and stops.
export default defineConfig({
  test: {
    environment: "edge-runtime",
    include: ["**/*.integration.test.ts"],
    globalSetup: ["./test/azurite.setup.js"],
    typecheck: {
      tsconfig: "./tsconfig.test.json",
    },
  },
});
