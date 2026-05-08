import 'dotenv/config';

const required = (key) => {
  const v = process.env[key];
  if (v === undefined || v === null || v === '') {
    throw new Error(`Missing required env var: ${key}`);
  }
  return v;
};

// `APP_TOKEN` is API-only — the worker doesn't serve HTTP, so it never
// authenticates incoming requests. We expose it but don't throw at import
// time; src/index.js (API entry) re-validates it at startup.
export const env = {
  port:          Number(process.env.PORT || 4000),
  nodeEnv:       process.env.NODE_ENV || 'development',
  appToken:      process.env.APP_TOKEN ?? '',
  databaseUrl:   required('DATABASE_URL'),
  redisUrl:      required('REDIS_URL'),
  gatewayWsUrl:  required('GATEWAY_WS_URL'),
  gatewayToken:  required('GATEWAY_TOKEN'),
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? '')
    .split(',').map((s) => s.trim()).filter(Boolean),
};

/** Throw if APP_TOKEN isn't long enough for production. Called by the API. */
export function requireAppToken() {
  if (!env.appToken || env.appToken.length < 32) {
    throw new Error(
      'APP_TOKEN missing or too short (need ≥32 chars). ' +
      'Set it in backend/.env — generate one with `openssl rand -hex 48`.',
    );
  }
}
