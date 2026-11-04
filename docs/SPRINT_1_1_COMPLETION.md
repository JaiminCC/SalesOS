# Sprint 1.1 completion

**Date:** 4 November 2026  
**Scope:** Infrastructure reliability, database security hardening, and the dependency audit.  
**Not in this sprint:** authentication, SSO, agent execution, and frontend redesign.

## Architecture changes

- The worker uses `DATABASE_URL_WORKER` (`salesos_worker`) for the relay and for job processing. The NestJS API stays on `DATABASE_URL_APP`.
- The API Redis client fails fast (`enableOfflineQueue: false`, one retry, 1 second connect timeout) so a Redis outage returns `202` and leaves the outbox `PENDING`.
- The worker relay runs every 2 seconds inside the worker process. It calls `public.list_pending_outbox(25)` and enqueues with a stable BullMQ job id. An "already exists" reply is ignored.
- Worker health is a JSON log line every 15 seconds. The process does not open an HTTP port.
- `SIGTERM` / `SIGINT` close the BullMQ worker, the queue, Redis, and Prisma, then log `worker stopped`.

## Database migration

Forward migration `packages/database/prisma/migrations/20261104143000_definer_roles/migration.sql`.

Applied history is unchanged:

1. `20261104130000_init`
2. `20261104130100_rls`
3. `20261104143000_definer_roles`

`salesos_definer` owns `tenant_is_active(uuid)` and cannot bypass RLS. `salesos_outbox` owns `list_pending_outbox(integer)`, is `NOLOGIN`, and is the only role with `BYPASSRLS`. `salesos_app` cannot execute the list function. The list result has no payload. Rollback steps are in `docs/operations/OUTBOX_RECOVERY.md`.

## Worker evidence

`pnpm dev:worker` connected to PostgreSQL and Redis, registered `foundation.ping` on queue `foundation`, and logged mailbox `UnconfiguredMailbox` and WhatsApp `UnconfiguredWhatsApp`.

Live calls used tenant `11111111-1111-4111-8111-111111111111` and `POST /api/v1/jobs/foundation-ping`.

| Case | Evidence |
|---|---|
| a. Success | `live-ok-1793780606694` ended `SUCCEEDED`, attempts 1, result `{pong:true}`, outbox `PROCESSED`. |
| b. Fail-once | `live-fail-1793780606694` logged `intentional retry` and ended `SUCCEEDED`, attempts 2, result `{pong:true}`. |
| c. Duplicate key | Replaying the same body returned HTTP 202 with `replay: true`. A different `mode` for the same key returned HTTP 409. |
| d. Redis down | With `infra-redis-1` stopped, `redis-down-1793780856145` returned HTTP 202 in 56 ms and stayed `QUEUED` / `PENDING`. After Redis was healthy the row was `SUCCEEDED`, attempts 1, outbox `PROCESSED`. Pending outbox count was 0. |
| e. Worker stopped | `queued-while-stopped-1793780652154` was HTTP 202, `QUEUED`, attempts 0, outbox `PENDING` while the worker was down. |
| f. Worker restarted | That same row became `SUCCEEDED`, attempts 1, outbox `PROCESSED`. |
| g. PostgreSQL down | The worker kept running, logged `outbox relay failed` and heartbeat `postgres: down`. After PostgreSQL was healthy the heartbeat returned to `up`. `after-postgres-1793780926542` completed. |
| h. Graceful shutdown | Automated SIGTERM exited 0, logged `worker stopped`, and did not log `.listen(`. A `tsx` reload also logged `worker stopped`. |
| i. No second side effect | Replaying `live-ok-1793780606694` left attempts at 1. The processor test calls the succeeded job again and expects the attempt count to stay put. |

API ready check after PostgreSQL returned: `GET /api/v1/health/ready` HTTP 200, `postgres: up`, `redis: up`.

## Security and dependencies

Reviewed in:

- `docs/security/SECURITY_DEFINER_REVIEW.md`
- `docs/security/DATABASE_SECURITY_AUDIT.md`
- `docs/security/DEPENDENCY_AUDIT_REPORT.md`
- `docs/security/DEPENDENCY_REMEDIATION_PLAN.md`

PostCSS GHSA-qx2v-qp2m-jg93, GHSA-6g55-p6wh-862q, GHSA-fxqj-rqcc-2cmp, and GHSA-r28c-9q8g-f849 are remediated by overriding `postcss` to 8.5.32. Six advisories remain open exceptions with owner Jaimin Belani and review deadline 4 December 2026. They are not resolved vulnerabilities.

## Git

The repository was already initialized. `main` tracks `origin` (`git@github.com:JaiminCC/SalesOS.git`) at `9be2709` (`chore: complete SalesOS Sprint 1 foundation`). Nothing was pushed. History was not rewritten. `.env` is ignored (`.gitignore` line 15). Sprint 1.1 changes are in the working tree and were not committed: the sprint instruction authorizes a new baseline commit only when Git is absent.

## Commands

| Command | Exit | Result |
|---|---|---|
| `pnpm lint` | 0 | ESLint completed with no findings. |
| `pnpm typecheck` | 0 | Packages built and every workspace typecheck completed. Prisma warned that `package.json#prisma` is deprecated. |
| `pnpm test` | 0 | 32 Vitest tests passed. See the breakdown below. The web script printed `PASS web source does not reference server secrets`. |
| `pnpm check:source` | 0 | 8 syntax checks passed and the feature-marker check passed. |
| `pnpm --filter @salesos/web build` | 0 | Next.js 15.5.29 compiled `/` and `/_not-found`. Warning: the Next.js ESLint plugin is not in the ESLint config. |
| `node scripts/check-audit.mjs` | 0 | `Audit advisories are covered by the exception list (6).` |
| `pnpm db:migrate` | 0 | Existing database `salesos` at `127.0.0.1:55433`. `No pending migrations to apply.` 3 migrations found. |
| `pnpm audit` | 1 | Expected while exceptions remain. Metadata after the PostCSS override: 2 critical, 1 high, 5 moderate, 0 low. |

An earlier `pnpm test` in this session exited 1. `apps/worker/src/recovery.spec.ts` hit Vitest's 5 second default while the blocked Redis client was still connecting. The client now fails fast and the test allows 20 seconds. The `pnpm test` row above is the run after that fix.

### `pnpm test` breakdown (exit 0)

| Package | Files | Tests |
|---|---|---|
| `@salesos/shared` | 1 | 4 |
| `@salesos/agent-core` | 2 | 2 |
| `@salesos/integrations` | 1 | 1 |
| `@salesos/database` | 5 | 13 |
| `@salesos/api` | 4 | 7 |
| `@salesos/worker` | 2 | 5 |
| `@salesos/web` | secret scan | pass, no Vitest count |

Database coverage inside those 13 tests:

- PostgreSQL connectivity: 1
- RLS, cross-tenant reads, pooled context reset, application role denied on `users`: 5 (`isolation.spec.ts`)
- SECURITY DEFINER owners, grants, payload hiding, uuid injection, suspended-tenant oracle: 3 (`definer.spec.ts`)
- Clean database: create `salesos_migration_probe`, `prisma migrate deploy` twice, drop the database: 1 (`migration-probe.spec.ts`, about 1.1 s)
- Field encryption: 3

Worker coverage inside those 5 tests: live Redis and PostgreSQL health, outbox left `PENDING` when Redis is unreachable then published once, SIGTERM, and fail-once retry plus a second call that does not change a succeeded job.

## Remaining risk

- Six dev-time or CLI advisories stay open until 4 December 2026. See the remediation plan.
- `tenant_is_active` tells a role that can execute it whether a known UUID is `ACTIVE`. Suspended and missing both return false.
- `salesos_worker` can list pending outbox metadata for every tenant. It cannot read payloads through that function and cannot read `users`.
- BullMQ can redeliver. External providers are not called yet. Later provider work must reconcile unknown timeouts instead of repeating them.
- Sprint 1.1 is not in a commit. Ask for a commit if this working tree should be recorded on `main`. Do not push unless that is requested separately.
- Demo auth in the browser is still `localStorage`.

## Acceptance

| # | Criterion | Status |
|---|---|---|
| 1 | Worker processes real BullMQ jobs | PASS |
| 2 | Retry and recovery verified | PASS |
| 3 | Jobs cannot cause duplicate external effects | PASS for this sprint. The only effect is the database row, guarded by the idempotency key, the BullMQ job id, and the `SUCCEEDED` short-circuit. No provider is called. |
| 4 | Outbox records are recoverable after failures | PASS |
| 5 | SECURITY DEFINER functions reviewed, documented, least privilege | PASS |
| 6 | Cross-tenant security tests pass | PASS |
| 7 | Advisories remediated or documented as exceptions | PASS. Four PostCSS advisories remediated. Six remain open exceptions with owner and deadline. |
| 8 | Existing frontend remains functional | PASS. UI source was not changed. Production build exited 0. Browser demo sign-in was not re-run this sprint. |
| 9 | API health checks pass | PASS. `/api/v1/health/ready` returned 200 with Postgres and Redis up. |
| 10 | Lint, typecheck, tests, and build pass | PASS. Exits recorded above. |
| 11 | Local Git baseline exists | PASS. `9be2709` on `main`. Sprint 1.1 is uncommitted. Nothing was pushed. |
| 12 | Sprint 2 readiness report | PASS. `docs/operations/SPRINT_2_READINESS.md`. |

No acceptance criterion is failing. Sprint 2 was not started.
