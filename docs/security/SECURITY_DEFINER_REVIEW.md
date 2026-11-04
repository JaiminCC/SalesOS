# SECURITY DEFINER review

**Date:** 4 November 2026  
**Database:** PostgreSQL 16, schema `public`  
**Migrations reviewed:** `20261104130000_init`, `20261104130100_rls`, `20261104143000_definer_roles`  
**Live catalog check:** the only functions outside `pg_catalog` and `information_schema` are the two below. Both are `SECURITY DEFINER`.

Sprint 1 created both functions under the migration role. Sprint 1.1 did not delete them. A forward migration moved ownership, locked `search_path`, removed the outbox payload from the list function, and split `EXECUTE` so the HTTP role cannot scan the outbox.

## Trust boundary

`list_pending_outbox(integer)` is an infrastructure function. The worker process is the only application runtime allowed to call it. It lists pending outbox identifiers across tenants so a crashed API process or a Redis outage can be recovered. That scan requires a role which bypasses forced row-level security. The bypass is confined to `salesos_outbox`, which cannot log in and can only `SELECT` `public.outbox_events`.

`salesos_app` is the NestJS role. It remains `NOSUPERUSER` and `NOBYPASSRLS`. It can execute `tenant_is_active(uuid)` and cannot execute `list_pending_outbox(integer)`. No tenant-facing route calls the list function. `POST /api/v1/jobs/foundation-ping` is gated by `INTERNAL_JOB_TOKEN` and uses `salesos_app`.

`salesos_worker` is the worker login. It is `NOSUPERUSER` and `NOBYPASSRLS`. It may execute the list function, then process each row inside `withTenant`, which sets `app.tenant_id` for that transaction only. It has the same tenant-table DML as the application role and no `SELECT` on `users`, `tenants`, `sessions`, `mfa_factors`, `recovery_codes`, `password_reset_tokens`, or `auth_attempts`.

Ordinary queries from the API and the worker use these login roles. Prisma migrations and seed use `DATABASE_URL`, which is the database owner. Application code does not connect as a superuser.

## `tenant_is_active(uuid)`

| Property | Value |
|---|---|
| Schema | `public` |
| Owner | `salesos_definer` (`NOLOGIN`, `NOSUPERUSER`, `NOBYPASSRLS`) |
| Security | `SECURITY DEFINER` |
| `search_path` | `pg_catalog` |
| Argument | `target uuid` |
| Returns | `boolean` |
| Body | `EXISTS` on `public.tenants` where `id = target` and `status = 'ACTIVE'` |
| Underlying privilege | `SELECT` on `public.tenants` for `salesos_definer` only |
| `EXECUTE` | `salesos_definer` (owner), `salesos_app`, `salesos_worker` |
| `PUBLIC` | revoked |

The function is security-definer because `tenants` has no row-level security and the login roles are not granted `SELECT` on it. Ownership does not bypass RLS: the owner has `NOBYPASSRLS`, and the only table it reads is not under RLS. References are schema-qualified. `search_path` is `pg_catalog`, so a temporary table or an attacker-controlled schema cannot shadow `tenants` or operators.

The return value is only a boolean. A suspended tenant and a missing UUID both return false, so the function does not disclose which of those two states applies. A caller who already knows a UUID and can execute the function can learn whether that tenant is currently `ACTIVE`. The jobs API maps a false result to `404 Tenant was not found` and does not echo the UUID in the error. There is no name, setting, or membership in the result.

## `list_pending_outbox(integer)`

| Property | Value |
|---|---|
| Schema | `public` |
| Owner | `salesos_outbox` (`NOLOGIN`, `NOSUPERUSER`, `BYPASSRLS`) |
| Security | `SECURITY DEFINER` |
| `search_path` | `pg_catalog` |
| Argument | `batch_size integer` |
| Returns | `tenant_id`, `id`, `event_type`, `aggregate_id`, `attempts` |
| Body | `public.outbox_events` where `status = 'PENDING'`, ordered by `created_at`, limited to `LEAST(GREATEST(batch_size, 0), 100)` |
| Underlying privilege | `SELECT` on `public.outbox_events` for `salesos_outbox` only |
| `EXECUTE` | `salesos_outbox` (owner), `salesos_worker` |
| `PUBLIC` and `salesos_app` | revoked |

`BYPASSRLS` is required. `outbox_events` has `FORCE ROW LEVEL SECURITY`, and a security-definer function runs as its owner. Without bypass, the owner would see no rows unless `app.tenant_id` were set, which would defeat recovery. The owner cannot log in, has no superuser bit, and is not granted DML beyond that one `SELECT`.

The payload column is not returned. A stolen worker credential can see pending tenant ids, outbox ids, event types, aggregate ids, and attempt counts. It cannot see the payload through this function. Processing still loads the job through RLS under the tenant id from the row.

`batch_size` is an integer. Values outside 0..100 collapse into that range. A non-integer fails in PostgreSQL before the function body runs.

## Grants observed on the Sprint 1 database

`information_schema.routine_privileges` on 4 November 2026:

- `list_pending_outbox`: `salesos_outbox`, `salesos_worker`
- `tenant_is_active`: `salesos_definer`, `salesos_app`, `salesos_worker`

`PUBLIC` was absent from both.

## What was not changed

`FORCE ROW LEVEL SECURITY` on the tenant tables from `20261104130100_rls` is unchanged. `withTenant` still sets `app.tenant_id` with `set_config(..., true)`, so the setting ends with the transaction and is not left on a pooled connection. Missing context returns zero rows.

## Rollback

Do not edit `20261104143000_definer_roles`. Recovery steps are in `docs/operations/OUTBOX_RECOVERY.md`. Re-granting `list_pending_outbox` to `salesos_app` would undo this review.
