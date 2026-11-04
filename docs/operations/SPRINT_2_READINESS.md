# Sprint 2 readiness

**Date:** 4 November 2026  
**Decision this sprint:** do not start authentication, SSO, or agent execution.

Sprint 2 can start when a reviewer accepts this note and `docs/SPRINT_1_1_COMPLETION.md`. The foundation below is in the working tree. It is not a second product.

## Ready

- NestJS API and BullMQ worker are separate processes. The worker has a JSON heartbeat and a SIGTERM shutdown path.
- `POST /api/v1/jobs/foundation-ping` commits the job, outbox row, and idempotency key before Redis. The worker relay republishes `PENDING` rows. Completed jobs do not run again as a second side effect.
- `salesos_app` and `salesos_worker` are `NOBYPASSRLS`. `list_pending_outbox` is executable only by the worker login and its `NOLOGIN` owner. The function does not return payloads.
- Tenant context is transaction-local. Cross-tenant reads and updates from the application role return no rows.
- CI installs dependencies, migrates, lints, typechecks, tests, checks source markers, builds the web app, and checks the audit register. Postgres and Redis are isolated services.
- The Next.js screens are unchanged. Demo sign-in is still `localStorage`.

## Prerequisites before writing Sprint 2 auth

1. Keep `DATABASE_URL` for migrations only. New auth queries must not connect as the migration owner.
2. Do not grant `salesos_app` `SELECT` on `users`, `sessions`, `mfa_factors`, `recovery_codes`, `password_reset_tokens`, or `auth_attempts`. Add a reviewed function or a dedicated auth role if the login path needs those rows.
3. Do not grant `list_pending_outbox` to `salesos_app` or to any role the HTTP server uses.
4. Session and tenant selection must set `app.tenant_id` inside the transaction that reads tenant data. A connection-scoped setting will leak across pooled requests.
5. External provider calls, when they arrive, need a stored operation id and a reconcile path. BullMQ retry is not exactly-once.
6. Revisit the six open dependency exceptions on or before 4 December 2026. They do not block an auth design, and they are not closed.
7. Generate `SALESOS_WORKER_PASSWORD` in every environment before `pnpm db:migrate`. The definer migration aborts if `salesos_worker` is missing.

## Not in this tree

- Password verification, MFA, SSO, and server sessions.
- A real mailbox or WhatsApp adapter.
- A production LLM provider. `packages/agent-core` still ships the fake provider only.

## Local start

```bash
pnpm infra:up
pnpm db:setup
pnpm dev:web
pnpm dev:api
pnpm dev:worker
```

Ready check: `curl -s http://127.0.0.1:3001/api/v1/health/ready`.

On this workstation PostgreSQL is published at `127.0.0.1:55433`. CI and the Compose default use `5432`.
