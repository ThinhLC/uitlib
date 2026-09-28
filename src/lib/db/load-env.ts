import { config as loadEnv } from 'dotenv';

// Connection settings come only from the environment (spec FR-030). Variables already set in the
// process win over .env.local, so CI or a shell can override any value. A module of its own
// because imports are hoisted: config.ts imports it before src/env.ts, so the file is loaded
// before validation runs. src/env.ts itself cannot load it, it runs in the browser too.
loadEnv({ path: '.env.local', quiet: true });
