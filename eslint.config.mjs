import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  { files: ["tests/**"], rules: { "@typescript-eslint/no-explicit-any": "off" } },
  { files: ["postcss.config.mjs"], rules: { "import/no-anonymous-default-export": "off" } },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "reference/**", "playwright-report/**", "test-results/**"]),
]);
