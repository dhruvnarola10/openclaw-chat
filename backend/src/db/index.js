import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema.js';
import { env } from '../env.js';

export const pool = new pg.Pool({
  connectionString: env.databaseUrl,
  max: 10,
});

export const db = drizzle(pool, { schema });
export * from './schema.js';

// Convenience: { ok, latencyMs } for /health.
export async function pingDb() {
  const t0 = Date.now();
  try {
    await pool.query('SELECT 1');
    return { ok: true, latencyMs: Date.now() - t0 };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
