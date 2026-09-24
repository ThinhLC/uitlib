import { defineConfig } from 'drizzle-kit';
import { dbConfig } from './src/lib/db/config';

// drizzle-kit connects as the owner; every value comes from .env.local (spec FR-030).
const owner = dbConfig('owner');

export default defineConfig({
  out: './drizzle',
  // Every file in this folder is a schema module (tables only; the barrel is ../tables.ts).
  schema: './src/lib/db/schema',
  dialect: 'mysql',
  dbCredentials: {
    host: owner.host,
    port: owner.port,
    user: owner.user,
    password: owner.password,
    database: owner.database,
  },
});
