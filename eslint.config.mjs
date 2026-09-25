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
  {
    // The API contract is imported by the UI: it may depend on zod only, never on server code.
    files: ["src/lib/api/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", {
        paths: ["mysql2", "mysql2/promise", "drizzle-orm", "jose", "standardwebhooks", "hono"],
        patterns: [
          { group: ["drizzle-orm/*", "hono/*", "@hono/*"], message: "The contract stays framework-free." },
          { group: ["@/lib/db/**", "@/server/**", "@/integrations/**", "**/lib/db/*", "**/server/*", "**/integrations/*"], message: "The contract must not import server code." },
        ],
      }],
    },
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
