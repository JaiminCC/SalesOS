# Worker operations

The worker is `apps/worker`. It is a separate OS process from the NestJS API. It does not call `listen` and it does not serve `/health`.

## Start

PostgreSQL and Redis must be up (`pnpm infra:up`). The gitignored `.env` must define `DATABASE_URL_WORKER`, `SALESOS_WORKER_PASSWORD`, and `REDIS_URL`. `pnpm db:setup` creates the worker role before migrations run.

```bash
pnpm dev:worker
```

Production entry is the same program: `node` running `apps/worker/src/main.ts` (via `tsx` in development). The package script is `tsx watch src/main.ts` for local development only.

Expected startup logs:

```json
{"level":"info","message":"worker heartbeat","postgres":"up","redis":"up","queue":"foundation","job":"foundation.ping"}
{"level":"info","message":"worker started","queue":"foundation","job":"foundation.ping","mailbox":"UnconfiguredMailbox","whatsapp":"UnconfiguredWhatsApp"}
```

## Health

Every 15 seconds the process writes one JSON line:

- `postgres`: `up` after `SELECT 1`, otherwise `down`
- `redis`: `up` after `PING` returns `PONG`, otherwise `down`
- `queue`: `foundation`
- `job`: `foundation.ping`

The level is `info` only when both dependencies are `up`. A down dependency is logged and the process stays up so it can resume when the dependency returns. Relay errors are separate lines: `outbox relay failed`.

The queue connection fails fast (`enableOfflineQueue: false`). The BullMQ worker connection keeps `maxRetriesPerRequest: null` so the consumer can reconnect.

## Jobs

Queue `foundation`, job name `foundation.ping`. Concurrency 4. Attempts 5 with exponential backoff starting at 200 ms. `fail-once` throws `intentional retry` on the first attempt, stores `FAILED_RETRYABLE`, and completes as `SUCCEEDED` on the next attempt. The last failed attempt is stored as `FAILED_FINAL`.

## Shutdown

`SIGINT` and `SIGTERM` clear the relay and heartbeat timers, close the BullMQ worker and queue, disconnect Redis, disconnect Prisma, log `worker stopped`, and exit 0. The handler ignores a second signal. Jobs left in Redis or rows left `PENDING` are picked up by the next process. See `docs/operations/OUTBOX_RECOVERY.md`.

Do not stop the worker by killing the `pnpm` parent if you need the `worker stopped` log. Signal the Node process that is running `src/main.ts`.

## Local ports used during Sprint 1.1

| Service | Address |
|---|---|
| API | `127.0.0.1:3001` |
| Web | `127.0.0.1:3000` |
| Redis | `127.0.0.1:6379` |
| PostgreSQL | `127.0.0.1:55433` on this machine, because host 5432 was already in use. The Compose default remains 5432. |

Test tenant: Northstar Demo `11111111-1111-4111-8111-111111111111`.
