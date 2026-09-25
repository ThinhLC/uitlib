import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

loadEnv({ path: '.env.local', quiet: true });

// Database tests share one schema, so files and tests run one at a time.
export default defineConfig({
  // Same alias as tsconfig.json: `@/...` resolves from `src/`.
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    include: ['tests/**/*.test.ts'],
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 60_000,
    hookTimeout: 120_000,
    globalSetup: './tests/helpers/global-setup.ts',
    setupFiles: ['./tests/helpers/invariants-after-each.ts'],
    env: { NODE_ENV: 'test' },
  },
});
