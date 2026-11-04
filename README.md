# SalesOS

Code Colonies SalesOS is a pnpm monorepo. The Next.js prototype stays in `apps/web` and still runs as a simulated workspace. Sprint 1 adds the production foundation around it: a NestJS API, a BullMQ worker, PostgreSQL with tenant row-level security, and Redis.

Authentication, SSO, and live AI agents are not implemented.

## Requirements

- Node.js 20.9+ (Node 22 recommended)
- pnpm 9.15.9 (`corepack enable && corepack prepare pnpm@9.15.9 --activate`)
- Docker with Compose, for PostgreSQL 16 and Redis 7

## Start locally

```bash
cp .env.example .env
# Replace every placeholder password and generate DATA_ENCRYPTION_KEY:
# node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

pnpm install
pnpm infra:up
pnpm db:setup
pnpm --filter "./packages/*" build
```

Then start the three processes:

```bash
pnpm dev:web
pnpm dev:api
pnpm dev:worker
```

- Web: http://127.0.0.1:3000
- API: http://127.0.0.1:3001
- Live probe: http://127.0.0.1:3001/health/live
- Ready probe: http://127.0.0.1:3001/health/ready

`./START_MAC_LINUX.sh` installs dependencies, starts PostgreSQL and Redis, migrates, and launches the web, API, and worker processes. On Windows, `START_WINDOWS.bat` does the same.

The web and API processes bind to `127.0.0.1`. Docker publishes PostgreSQL and Redis on `127.0.0.1` as well. `infra/docker-compose.prod.yml` keeps those ports unpublished and is the production Compose file for the data services.

## Checks

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm --filter @salesos/web build
pnpm check:source
```

Database tests that need PostgreSQL are skipped when `DATABASE_URL` is unset. API and worker integration tests are skipped when `DATABASE_URL_APP` or `REDIS_URL` is unset. Run `pnpm infra:up` and `pnpm db:setup` first so those tests execute.

## Layout

| Path | Role |
|---|---|
| `apps/web` | Existing SalesOS Next.js UI |
| `apps/api` | NestJS REST API under `/api/v1`, plus unversioned health probes |
| `apps/worker` | BullMQ worker. It does not listen for HTTP |
| `packages/database` | Prisma schema, migrations, tenant helper, seed |
| `packages/shared` | Envelopes, permissions, job names. No framework imports |
| `packages/agent-core` | LLM port. Sprint 1 ships a fake provider only |
| `packages/integrations` | External ports that fail closed until a later sprint |
| `infra` | Development and production Compose files |

`DATABASE_URL` is the migration and seed role. `DATABASE_URL_APP` is `salesos_app`, which cannot bypass row-level security and cannot read platform user tables. Browser code only receives `NEXT_PUBLIC_*` values.

## Example job

`POST /api/v1/jobs/foundation-ping` with `Authorization: Bearer $INTERNAL_JOB_TOKEN` and a JSON body `{ "tenantId", "idempotencyKey", "mode" }`. `mode` is `ok` or `fail-once`. The API writes the job, an outbox row, and an idempotency key in one tenant transaction, then enqueues BullMQ job `foundation.ping`. The worker stores the result on `job_executions`.

Seeded tenants:

- Northstar Demo `11111111-1111-4111-8111-111111111111`
- Sample Agency `22222222-2222-4222-8222-222222222222`

## Prototype screens

The clickable UI is unchanged aside from an API connection badge beside the existing SIMULATED badge. Screen data still lives in browser `localStorage` under `salesos-prototype-v2`.

- **Command Center:** operational feed, KPI tiles, agent health, simulated automation, pause/resume.
- **AI Agents:** eight specialist agents and their simulated configuration.
- **Execution Inspector:** filter runs and replay failed simulated jobs.
- **Lead Discovery, Campaigns, AI Inbox, Qualification, Meetings, Approvals, Analytics, Products, Settings.**
- **Enterprise:** preferences, security center, SSO drafts, users and roles, integrations, WhatsApp, webhooks, audit export.

Demo sign-in accepts any valid email, any password of 8 or more characters, and any six-character MFA code. Nothing is checked on a server. Do not enter real passwords.

## Known prototype limits

Meeting task checkboxes show a toast only. The SSO checklist does not persist. The analytics period control does not change the figures. The tenant switcher changes a label. The qualified KPI adds 44 to the count. Demo currency is hard-coded. These stay as they are until a later sprint replaces the simulated data.
