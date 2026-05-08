# Leonardo API

Mission-control style dashboard backend for the Leonardo AI workspace.

- **Express** API at `:4000`, runs natively under PM2 (`leonardo-api`)
- **Postgres** (Docker) for persistent state
- **Redis** (Docker) for the BullMQ task queue + SSE pub/sub
- **Worker** (Docker) consumes the queue and drives tasks through the OpenClaw gateway

```
Browser ──► nginx ──► /api/v1/* ──► leonardo-api (PM2)
                                       │
                                       ├──► Postgres (Docker)
                                       ├──► Redis    (Docker)
                                       └──► OpenClaw gateway (WS)

Worker (Docker) ◄── Redis ──► leonardo-api
       │
       └──► OpenClaw gateway (chat.send + chat events)
```

## First-time setup

```bash
cd backend
cp .env.example .env
$EDITOR .env                              # set APP_TOKEN, GATEWAY_TOKEN, etc.

# Bring up DB + Redis + Worker
docker compose up -d

# Install API deps and run migrations
npm install
npm run db:generate                       # writes SQL into src/db/migrations/
npm run db:migrate                        # applies them to Postgres

# Start the API natively under PM2
cd .. && pm2 start ecosystem.config.cjs --only leonardo-api
pm2 save
```

## Health check

```bash
curl -H "Authorization: Bearer $APP_TOKEN" http://127.0.0.1:4000/api/v1/health
# → { "ok": true, "db": {...}, "redis": {...}, ... }
```

## Schema changes

Edit `src/db/schema.js`, then:

```bash
npm run db:generate          # creates a new migration in src/db/migrations
npm run db:migrate           # applies it
```

## Routes

All under `/api/v1/`, all require `Authorization: Bearer <APP_TOKEN>`:

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | DB + Redis + uptime |
| `GET POST` | `/orgs` | Organizations |
| `GET PATCH DELETE` | `/orgs/:id` | |
| `GET POST` | `/orgs/:id/board-groups` | |
| `GET PATCH DELETE` | `/board-groups/:id` | |
| `GET POST` | `/board-groups/:id/boards` | |
| `GET PATCH DELETE` | `/boards/:id` | |
| `GET POST` | `/boards/:id/tasks` | |
| `GET PATCH DELETE` | `/tasks/:id` | |
| `POST` | `/tasks/:id/assign` | Enqueue worker job |
| `POST` | `/tasks/:id/cancel` | Abort current run |
| `GET` | `/tasks/:id/stream` | SSE: status + transcript deltas |
| `GET POST` | `/agents` | Real (gateway) + virtual (DB) |
| `PATCH DELETE` | `/agents/:id` | (virtual only) |
| `GET POST` | `/approvals` | List, create |
| `PATCH` | `/approvals/:id` | Approve / reject |
| `GET` | `/approvals/stream` | SSE feed |
| `GET` | `/activity?limit=100` | Audit log |

## Worker jobs

| Name | Trigger | Effect |
|---|---|---|
| `assign` | `POST /tasks/:id/assign` | Patches session model/instructions, calls `chat.send`, streams the reply via SSE, persists final state |
| `cancel` | `POST /tasks/:id/cancel` | Calls `chat.abort` on the gateway, marks task `cancelled` |

## Logs

```bash
pm2 logs leonardo-api            # API
docker compose logs -f worker    # Worker
docker compose logs -f postgres  # DB
```

## Backups

```bash
docker compose exec postgres pg_dump -U leonardo leonardo > leonardo-$(date +%F).sql
```
