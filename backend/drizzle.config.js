import 'dotenv/config';

/** Drizzle Kit config — reads the schema and writes SQL migrations. */
export default {
  schema:        './src/db/schema.js',
  out:           './src/db/migrations',
  dialect:       'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ||
      'postgresql://leonardo:leonardo@127.0.0.1:5433/leonardo',
  },
  strict: true,
  verbose: true,
};
