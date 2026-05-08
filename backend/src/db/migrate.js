// Runs SQL migrations from src/db/migrations/. Invoked by `npm run db:migrate`.

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { fileURLToPath } from 'url';
import path from 'path';
import 'dotenv/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: url, max: 1 });
const db = drizzle(pool);

console.log('[migrate] running migrations…');
await migrate(db, { migrationsFolder: path.join(__dirname, 'migrations') });
console.log('[migrate] done');
await pool.end();
