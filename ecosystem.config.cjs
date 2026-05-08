// PM2 process manifest.
//
// Usage on a fresh deploy:
//   npm install
//   npm run build
//   pm2 start ecosystem.config.cjs        # starts leonardo-web by default
//   pm2 save                              # persist across reboot
//   pm2 startup                           # one-time: copy & run the printed sudo cmd
//
// Defines two apps:
//   • leonardo-web  — production. Serves dist/ via `vite preview` with
//                      /api + /ws proxied to the OpenClaw gateway.
//   • leonardo-dev  — dev server with HMR. Started only on demand via:
//                      pm2 start ecosystem.config.cjs --only leonardo-dev
//
// Both invoke `vite` directly out of node_modules — no `npm run` wrapper
// — so they work regardless of what scripts your package.json has.
//
// Tunable via env when launching:
//   PORT=3001 GATEWAY_URL=http://10.0.0.5:18789 pm2 start ecosystem.config.cjs
//
// Logs: ~/.pm2/logs/leonardo-web-{out,error}.log  (or `pm2 logs leonardo-web`).

const path = require('path');
const VITE_BIN = path.join(__dirname, 'node_modules', '.bin', 'vite');

const PORT        = process.env.PORT        || '3001';
const GATEWAY_URL = process.env.GATEWAY_URL || 'http://127.0.0.1:18789';

module.exports = {
  apps: [
    {
      name:        'leonardo-web',
      script:      VITE_BIN,
      args:        ['preview', '--host', '0.0.0.0', '--port', PORT, '--strictPort'],
      cwd:         __dirname,
      exec_mode:   'fork',
      instances:   1,
      autorestart: true,
      watch:       false,
      max_memory_restart: '512M',
      env: {
        NODE_ENV:    'production',
        PORT,
        GATEWAY_URL,
      },
      // Restart strategy
      min_uptime:    '10s',
      max_restarts:  10,
      restart_delay: 2000,
    },

    // Dev server — only starts when explicitly targeted.
    {
      name:        'leonardo-dev',
      script:      VITE_BIN,
      args:        ['--host', '0.0.0.0', '--port', PORT],
      cwd:         __dirname,
      exec_mode:   'fork',
      instances:   1,
      autorestart: false,
      watch:       false,
      env: {
        NODE_ENV:    'development',
        PORT,
        GATEWAY_URL,
      },
    },

    // Backend API — Express server backed by Postgres + Redis (Docker).
    // Picks up its own env from backend/.env via dotenv.
    {
      name:        'leonardo-api',
      script:      'src/index.js',
      cwd:         path.join(__dirname, 'backend'),
      exec_mode:   'fork',
      instances:   1,
      autorestart: true,
      watch:       false,
      max_memory_restart: '512M',
      env: {
        NODE_ENV:    'production',
        PORT:        process.env.API_PORT || '4000',
      },
      min_uptime:    '10s',
      max_restarts:  10,
      restart_delay: 2000,
    },
  ],
};
