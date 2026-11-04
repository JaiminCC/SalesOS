# CI workspace build fix

**Date:** 4 November 2026  
**pnpm:** 9.15.9  
**Node.js:** 22.21.0  
**TypeScript:** 5.9.3  
**Prisma:** 6.19.3

## Root cause

`@salesos/shared` publishes `"main": "./dist/index.js"`. Nothing in git contains that file. `pnpm db:setup` used to run generate, role, migrate, and seed without compiling workspace packages first.

`packages/database/src/seed.ts` imports `SYSTEM_ROLE_PERMISSIONS` and `SYSTEM_ROLES` from `@salesos/shared`. On a clean checkout, Node resolves that package through `packages/database/node_modules/@salesos/shared` and then fails:

```text
Cannot find module '.../packages/database/node_modules/@salesos/shared/dist/index.js'
```

`packages/database/src/ensure-app-role.ts` does not import `@salesos/shared`. With the identity password set, `pnpm db:role` completes while `packages/shared/dist` is still absent. The missing module is raised by `pnpm db:seed`.

A fresh GitHub Actions job would also stop at `pnpm db:role` before the seed import, because `ensure-app-role.ts` requires `SALESOS_IDENTITY_PASSWORD` and the workflow did not set it.

The Prisma `package.json#prisma` deprecation warning is printed by `prisma generate`. It is not this failure. Prisma was not upgraded.

## Dependency graph

```text
@salesos/database
  ├── @salesos/shared     workspace:*   main: ./dist/index.js
  ├── @prisma/client
  └── pg

@salesos/agent-core     → @salesos/shared
@salesos/integrations   → @salesos/shared
@salesos/api            → database, shared, agent-core, integrations
@salesos/worker         → database, shared, agent-core, integrations
@salesos/web            → no workspace packages
```

`pnpm --filter "@salesos/database^..."` on pnpm 9.15.9 selects only the workspace dependencies of `@salesos/database`. That set is `@salesos/shared`.

Imports of `@salesos/shared` that need the compiled file at runtime:

- `packages/database/src/seed.ts`
- `apps/api` (several modules)
- `apps/worker` (main, processor, health, specs)

`pnpm typecheck` and `pnpm test` already build `./packages/*` before their own checks. They run after `pnpm db:setup` in CI, so they did not create `dist` in time for the seed.

## Files changed

- `package.json`
- `.github/workflows/ci.yml`
- `docs/CI_WORKSPACE_BUILD_FIX.md`

Database role, RLS, and seed security logic were not changed.

## CI execution order

`pnpm db:setup` is now:

1. `pnpm db:generate` — Prisma Client
2. `pnpm build:dependencies` — `pnpm --filter "@salesos/database^..." build`
3. `pnpm db:role`
4. `pnpm db:migrate`
5. `pnpm db:seed`

The workflow still calls one setup step, so local and CI use the same sequence:

1. `pnpm install --frozen-lockfile`
2. `pnpm db:setup`
3. `pnpm lint`
4. `pnpm typecheck`
5. `pnpm test`
6. `pnpm check:source`
7. `pnpm --filter @salesos/web build`
8. `node scripts/check-audit.mjs`

The workflow environment now includes `DATABASE_URL_IDENTITY`, `SALESOS_IDENTITY_PASSWORD`, `MAIL_MODE=capture`, and `SALESOS_QUEUE_PREFIX=ci`. The identity values are what `pnpm db:role` and the API process require. The queue prefix keeps CI jobs off the default queue name.

## Commands executed

Clean checkout at `/tmp/salesos-ci-clean` after `pnpm install --frozen-lockfile`, with no `packages/shared/dist`, against a separate Postgres 16 on `127.0.0.1:55434` and Redis 7 on `127.0.0.1:6380`.

| Command | Result |
|---|---|
| `node` `require('@salesos/shared')` from `packages/database` before the build | FAIL. Missing `packages/database/node_modules/@salesos/shared/dist/index.js`. |
| `pnpm db:role` before the shared build | PASS. `salesos_app`, `salesos_worker`, and `salesos_identity` roles ready. |
| `pnpm db:seed` before the shared build | FAIL. Same missing `dist/index.js`, thrown from `tsx src/seed.ts`. |
| `pnpm db:setup` | PASS. Prisma Client 6.19.3 generated. `@salesos/shared` compiled. Roles ready. Migrations `20261104130000_init`, `20261104130100_rls`, `20261104143000_definer_roles`, and `20261104160000_identity` applied. Seed completed. |
| `require.resolve('@salesos/shared')` from `packages/database` | PASS. Resolved to `packages/shared/dist/index.js`. |
| `pnpm --filter "./packages/*" build`, then API and worker `tsc` builds | PASS. |
| `node apps/worker/dist/main.js` | PASS. Logged `worker started` with postgres and redis `up`. |
| `node apps/api/dist/main.js` on `127.0.0.1:3012` | PASS. Logged `api listening`. `GET /health/live` returned `live`. `GET /health/ready` returned `ready` with postgres and redis `up`. |

Regression commands in the main workspace:

| Command | Exit | Result |
|---|---|---|
| `pnpm lint` | 0 | PASS |
| `pnpm typecheck` | 0 | PASS. Prisma printed the `package.json#prisma` deprecation warning. |
| `pnpm test` | 0 | PASS. 42 Vitest tests and the web secret scan. |
| `pnpm check:source` | 0 | PASS |
| `pnpm --filter @salesos/web build` | 0 | PASS |

Database tests that passed: forced RLS on tenant tables, missing tenant context returns no rows, no cross-transaction leak, `salesos_app` cannot read platform users, tenant activity check, and the four security-definer privilege tests (no RLS bypass, worker-only outbox listing, suspended-tenant hiding, membership and invitation lookup kept off the application role). Worker tests that passed: foundation retry and result storage, and the three outbox recovery tests.

## Remaining issues

GitHub Actions was not executed from this session, so this document does not claim the workflow run succeeded. The local clean checkout follows the same install and `pnpm db:setup` commands the workflow runs.

Prisma still warns that `package.json#prisma` is deprecated and will be removed in Prisma 7. That warning is unrelated to the missing module.
