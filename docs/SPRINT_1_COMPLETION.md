# Sprint 1 completion

**Date:** 4 November 2026  
**Scope:** Production project foundation. Authentication, SSO, and live AI agents were not implemented. The existing SalesOS screens still run from browser `localStorage`.

## What is in place

- pnpm workspace with `apps/web`, `apps/api`, `apps/worker`, and `packages/database`, `packages/shared`, `packages/agent-core`, `packages/integrations`.
- The Next.js prototype moved under `apps/web` without a redesign. An API connection badge sits beside the existing SIMULATED badge.
- PostgreSQL 16 via Prisma. Migrations: `20261104130000_init` and `20261104130100_rls`.
- Application role `salesos_app` (`NOBYPASSRLS`). Tenant tables use forced row-level security. `tenant_is_active(uuid)` and `list_pending_outbox(integer)` are security-definer functions. The app role cannot select platform user rows.
- Redis and BullMQ. `POST /api/v1/jobs/foundation-ping` writes a job, outbox row, and idempotency key in one tenant transaction, then enqueues `foundation.ping`. The worker retries `fail-once` and stores the result on `job_executions`.
- NestJS API on `127.0.0.1:3001`: URI versioning, validation, one error envelope, JSON logs that redact secret-like fields, CORS from `WEB_ORIGIN`, and `/health/live`, `/health/ready`, `/api/v1/health/live`, `/api/v1/health/ready`.
- Docker Compose for PostgreSQL and Redis. Development publishes ports on `127.0.0.1`. Production Compose does not publish them.
- CI workflow at `.github/workflows/ci.yml`.
- Two seeded tenants: Northstar Demo `11111111-1111-4111-8111-111111111111` and Sample Agency `22222222-2222-4222-8222-222222222222`. Emails are AES-256-GCM ciphertext plus HMAC.

## Commands executed

```bash
pnpm install
docker compose --env-file .env -f infra/docker-compose.yml up -d
pnpm db:setup
pnpm lint
pnpm typecheck
pnpm test
pnpm check:source
pnpm --filter @salesos/web build
node scripts/check-audit.mjs
pnpm dev:api
pnpm dev:web
```

Colima was stopped and started because the VM agent was not running. Host port 5432 was already taken by another project's Postgres container, so the local `.env` (gitignored) publishes SalesOS Postgres on `127.0.0.1:55433`. The committed Compose default remains `5432`.

A leftover `next dev` from the repository root was returning HTTP 500 after the UI move. That process was stopped so `apps/web` could bind to port 3000.

## Test results

These commands exited 0 on this machine after the database and Redis containers were healthy:

| Command | Result |
|---|---|
| `pnpm lint` | Pass. Re-run after the API injection fix also passed. |
| `pnpm typecheck` | Pass for web, shared, database, agent-core, integrations, API, and worker. API typecheck was run again after the injection fix. |
| `pnpm test` | 25 tests passed, plus the web secret scan. |
| `pnpm --filter @salesos/api test` | 7 passed again after explicit `@Inject` was added so `tsx` can boot Nest. |
| `pnpm check:source` | Pass. Menu ids and enterprise markers are still present. |
| `pnpm --filter @salesos/web build` | Pass. Next.js 15.5.29. Route `/` first-load JS 304 kB. |
| `node scripts/check-audit.mjs` | Pass. 10 advisories match `docs/security/dependency-exceptions.json`. |
| `GET http://127.0.0.1:3001/health/live` | 200, `data.status` `live`. |
| `GET http://127.0.0.1:3001/health/ready` | 200, postgres `up`, redis `up`. |
| `GET http://127.0.0.1:3001/api/v1/health/ready` | 200, same body. |

Test breakdown from `pnpm test`:

- `@salesos/shared`: 4 passed
- `@salesos/agent-core`: 2 passed
- `@salesos/integrations`: 1 passed
- `@salesos/database`: 9 passed (connectivity, encryption, forced RLS, missing tenant context returns no rows, cross-tenant filter returns no rows, `salesos_app` cannot read `users`, `tenant_is_active`)
- `@salesos/api`: 7 passed (env validation, log redaction, ready returns 503 when dependencies are down, live and ready return 200 against Postgres and Redis, foundation job rejects a missing token, accepts a job, and rejects a reused idempotency key)
- `@salesos/worker`: 2 passed (no HTTP listener, `fail-once` retries and stores `{ pong: true }` with at least two attempts)
- `@salesos/web`: secret scan passed

Headless Chrome loaded `http://127.0.0.1:3000/`, completed the demo sign-in and six-digit MFA step, and then showed both `SIMULATED` and `API CONNECTED` (`api-health api-health-connected`). Command Center and the AI Agents menu were present. Playwright was not installed and was not run.

## Remaining issues

- Authentication, SSO, RBAC enforcement, and real model calls are intentionally absent. System roles and permission names are seeded so a later sprint can attach them.
- Demo screens still use `localStorage` key `salesos-prototype-v2`. Known prototype limits remain: meeting task checkboxes only toast, the SSO checklist does not persist, the analytics period does not change figures, the tenant switcher changes a label, the qualified KPI adds 44, and demo currency is hard-coded.
- `pnpm audit` still reports nested PostCSS inside Next.js 15.5.29, Vitest 3 / tinypool, `@prisma/config` `deepmerge-ts` 7, and ESLint 9 `minimatch`. Direct PostCSS is 8.5.32. Multer is overridden to 2.5.0. Direct Zod is 4.6.7. Do not force-upgrade Next to clear the PostCSS advisories. The exception file is dated 4 November 2026.
- Prisma prints a deprecation warning for `package.json#prisma`. Behavior is unchanged on Prisma 6.19.3.
- This checkout is not a git repository, so CI has not run on a remote.
- On this Mac, port 5432 is occupied by another container. A clean machine can keep the example port.

## How to start locally

```bash
cp .env.example .env
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
# Put that value in DATA_ENCRYPTION_KEY and replace both passwords.
# If 5432 is taken, set POSTGRES_PORT and the host port in both database URLs.

pnpm install
pnpm infra:up
pnpm db:setup
pnpm --filter "./packages/*" build
pnpm dev:web
pnpm dev:api
pnpm dev:worker
```

Web: http://127.0.0.1:3000  
API: http://127.0.0.1:3001/health/ready

`./START_MAC_LINUX.sh` does the install, Compose, migrate, and process launch. `START_WINDOWS.bat` does the same with separate windows for the API and worker.

At the end of this sprint the web and API dev processes were left running. The worker was not started.
