# Outbox recovery

The foundation job is durable in PostgreSQL before it is handed to Redis.

## Write path

`POST /api/v1/jobs/foundation-ping` runs in one `withTenant` transaction:

1. Insert `job_executions` as `QUEUED`.
2. Insert `outbox_events` as `PENDING`. The payload stays in this row.
3. Insert `idempotency_keys` for `POST /api/v1/jobs/foundation-ping`.

The transaction commits, then the API calls BullMQ `queue.add`. The API Redis client uses `maxRetriesPerRequest: 1`, `connectTimeout: 1000`, and `enableOfflineQueue: false`, so a dead Redis connection fails the command instead of holding the HTTP request. The handler still returns `202`. The outbox row stays `PENDING`.

The same idempotency key and the same body hash return the original job with `replay: true` and do not insert another outbox row. The same key with a different mode returns `409`.

## Relay

The worker process, not the NestJS server, polls every 2 seconds:

```sql
SELECT * FROM public.list_pending_outbox(25);
```

That function returns identifiers only. For `job.foundation_ping.v1` the worker enqueues BullMQ job `foundation.ping` with job id `{tenantId}_{outboxId}`. BullMQ rejects `:` in custom ids. If Redis answers that the job already exists, the relay treats that as success and continues. Any other Redis error is logged as `outbox relay failed` and the row stays `PENDING` for the next pass.

A second publish after the worker has marked the row `PROCESSED` does not create another execution. `processFoundationPing` returns `{ pong: true }` immediately when `job_executions.status` is already `SUCCEEDED`, and it does not increment `attempts`.

## What BullMQ does not guarantee

BullMQ can deliver a job more than once. SalesOS does not treat a BullMQ acknowledgement as exactly-once. The persistent guards are:

- one idempotency key per tenant and route, stored before enqueue
- one BullMQ job id derived from the tenant and the outbox id
- a `SUCCEEDED` short-circuit inside the tenant transaction

`foundation.ping` has no external side effect. Mailbox and WhatsApp ports are `UnconfiguredMailbox` and `UnconfiguredWhatsApp` and are not called. When a later sprint performs a provider call, the worker must store a provider operation id and reconcile an unknown timeout. It must not blindly repeat a call the provider cannot confirm.

## Failure cases checked on 4 November 2026

| Case | Result |
|---|---|
| Redis container stopped, then `POST` | HTTP 202 in 56 ms. Job `QUEUED`, outbox `PENDING`. API log: Redis stream not writable because the offline queue is disabled. |
| Redis started again | Same job `SUCCEEDED`, attempts 1, outbox `PROCESSED`. Pending outbox count returned to 0. |
| Worker stopped with a job already `QUEUED` | Row stayed `QUEUED` / `PENDING` (`queued-while-stopped-1793780652154`). |
| Worker started again | That row became `SUCCEEDED`, attempts 1, outbox `PROCESSED`. |
| PostgreSQL stopped | Worker process kept running. Logs: `outbox relay failed` and heartbeat `postgres: down`, `redis: up`. |
| PostgreSQL started again | Heartbeat returned to `postgres: up`. A new job completed. API `/api/v1/health/ready` returned 200. |
| Replay of a completed job | HTTP 202, `replay: true`, attempts stayed 1. |

Automated coverage is `apps/worker/src/recovery.spec.ts`. It uses a Redis URL on `127.0.0.1:1` and asserts the outbox row is still `PENDING`, then publishes through the real Redis and asserts one `SUCCEEDED` row.

## Rollback of `20261104143000_definer_roles`

This migration is forward-only. Do not edit it and do not run `prisma db push`.

If `prisma migrate deploy` fails before recording the migration, fix the error and deploy again. The migration creates roles only when missing, drops both functions before creating them, and revokes `PUBLIC`. Re-running the SQL is the recovery for a partial apply. `pnpm db:role` must already have created `salesos_worker`.

Restoring the Sprint 1 grant (`GRANT EXECUTE ON FUNCTION public.list_pending_outbox(integer) TO salesos_app`) would let the HTTP role scan every tenant's pending outbox metadata. Do not ship that statement. If the worker role is unusable, repair `DATABASE_URL_WORKER` and `SALESOS_WORKER_PASSWORD`, then run `pnpm db:role`. Add a new forward migration only if the function body itself has to change again.

Take a logical backup with `pg_dump` before applying this migration on a shared database. Restore that dump if the migration is applied to the wrong instance. There is no down migration in the repository.
