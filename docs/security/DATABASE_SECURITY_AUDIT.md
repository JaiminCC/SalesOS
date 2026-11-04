# Database security audit

**Date:** 4 November 2026  
**Scope:** Sprint 1 schema plus migration `20261104143000_definer_roles`.  
**Function-level review:** `docs/security/SECURITY_DEFINER_REVIEW.md`.

## Roles

| Role | Login | Superuser | Bypass RLS | Used by |
|---|---|---|---|---|
| Database owner (`DATABASE_URL`) | yes | as created by Compose | yes, owner | `pnpm db:migrate`, `pnpm db:seed` |
| `salesos_app` | yes | no | no | NestJS API (`DATABASE_URL_APP`) |
| `salesos_worker` | yes | no | no | BullMQ worker (`DATABASE_URL_WORKER`) |
| `salesos_definer` | no | no | no | Owns `tenant_is_active` |
| `salesos_outbox` | no | no | yes | Owns `list_pending_outbox` |

`pnpm db:role` creates the two login roles from `SALESOS_APP_PASSWORD` and `SALESOS_WORKER_PASSWORD`. Those passwords are not in SQL. The migration refuses to run if `salesos_worker` is missing.

The API process does not open `DATABASE_URL`. The worker process does not open `DATABASE_URL` or `DATABASE_URL_APP`. Health checks and job handling on the API use `salesos_app`.

## Tenant context

Policies compare `tenant_id` to `nullif(current_setting('app.tenant_id', true), '')::uuid`. `withTenant` sets that value inside an interactive transaction and passes `true` as the local flag, so commit, rollback, and returning the connection to the pool clear it. A query without the setting sees zero rows. The next transaction must set the setting again.

Tenant ids are validated as UUIDs in `withTenant` before the transaction starts. Job routes take `tenantId` from the JSON body only after the internal bearer token matches.

## Cross-tenant results

Executed in `packages/database/src/isolation.spec.ts` and `packages/database/src/definer.spec.ts` against the live database:

- Tenant A membership reads do not include tenant B, including when the filter explicitly asks for tenant B.
- A pooled query after a tenant A transaction returns no memberships.
- Tenant A `updateMany` against tenant B jobs updates 0 rows.
- Tenant A outbox reads contain only tenant A rows.
- `salesos_app` cannot `SELECT` `users` or `tenants`.
- `salesos_worker` cannot `SELECT` `users`.
- `salesos_app` calling `list_pending_outbox(1)` fails with permission denied.
- `tenant_is_active` is false for both a suspended tenant and a UUID that does not exist.
- A string payload of `'; DROP TABLE public.tenants; --` passed to `tenant_is_active` fails uuid parsing and does not execute as SQL.
- `list_pending_outbox(100000)` returns at most 100 rows and the column list is exactly `tenant_id`, `id`, `event_type`, `aggregate_id`, `attempts`.

`FORCE ROW LEVEL SECURITY` is true on every table that has a `tenant_id` column. The isolation test fails if any of those tables drop RLS or forced RLS.

## Residual risk

A holder of `INTERNAL_JOB_TOKEN` can ask whether a UUID they already possess is an active tenant. The API responds with the same not-found error for inactive and unknown tenants. The boolean function itself is still callable by `salesos_app` and `salesos_worker`.

A holder of the worker password can list pending outbox metadata for every tenant and can then process a job under that tenant's RLS context. The worker password is an infrastructure secret. It is not embedded in the web app and is not accepted by the HTTP API.

`salesos_outbox` has `BYPASSRLS`. That is intentional and limited to a `NOLOGIN` owner of one `SELECT`. Do not grant this role to the API, and do not inherit it from `salesos_app`.

Platform tables (`users`, sessions, MFA, recovery codes, password resets, auth attempts) are not readable by the application or worker roles. They also are not under the tenant RLS policy. Sprint 2 authentication must keep using a narrowly granted path for those tables rather than giving `salesos_app` broad `SELECT`.

## Migration verification

On the existing Sprint 1 database, `20261104143000_definer_roles` is recorded in `_prisma_migrations` with a finish time, after `20261104130000_init` and `20261104130100_rls`.

`packages/database/src/migration-probe.spec.ts` creates a separate database, grants connect to both login roles, runs `prisma migrate deploy` twice, checks that both functions exist, and drops that database. The second deploy is a no-op.
