import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  {
    // Scripts and tests read raw MySQL rows whose shape depends on the query; `any` is accepted
    // there. Application code under src/ keeps the strict rule.
    files: ["scripts/**/*.ts", "tests/**/*.ts"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Scratch output of scripts/db/spike.ts and local tooling.
    ".tmp/**",
    "backups/**",
  ]),
]);

export default eslintConfig;
