import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    include: ["src/**/*.test.ts", "tests/unit/**/*.test.ts"],
    environment: "node",
    // The logic in src/lib must stay tested: CI fails when coverage drops below these floors (today's level minus one
    // point, set 1 Nov 2026). Raise them as coverage grows; never lower them to make a run pass.
    coverage: {
      provider: "v8",
      include: ["src/lib/**"],
      reporter: ["text-summary"],
      thresholds: { statements: 84, branches: 75, functions: 86, lines: 87 },
    },
  },
});
