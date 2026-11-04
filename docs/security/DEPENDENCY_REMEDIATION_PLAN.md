# Dependency remediation plan

**Date:** 4 November 2026  
**Owner:** Jaimin Belani  
**Next review:** 4 December 2026  
**Rule:** no `pnpm audit --fix --force`, no major upgrade whose only purpose is to silence an advisory, no exception without a deadline.

## Done

| Change | Why | Verification |
|---|---|---|
| `pnpm.overrides.postcss` = `8.5.32` | Removes GHSA-qx2v-qp2m-jg93, GHSA-6g55-p6wh-862q, GHSA-fxqj-rqcc-2cmp, and GHSA-r28c-9q8g-f849 from the nested Next 15.5.29 copy without moving Next to 16. 15.5.29 is the newest Next 15.5 and still depends on postcss 8.4.31. | `pnpm install`, lockfile no longer contains `postcss@8.4.31`, `pnpm audit` no longer lists those four ids, web production build exited 0. |
| `scripts/check-audit.mjs` requires `owner`, `reason`, and `reviewBy`, and fails when `reviewBy` is before today | An exception that expires cannot keep CI green. | `node scripts/check-audit.mjs` exited 0 on 4 November 2026 and reported 6 ids. |

`multer` stays overridden at 2.5.0. Direct `zod` stays 4.6.7. Neither is an open advisory.

## Still open

These stay in `docs/security/dependency-exceptions.json`. They are not resolved.

### Vitest 3 / tinypool / `@vitest/mocker`

| Advisory | Installed | Patch | Why it was not applied |
|---|---|---|---|
| GHSA-5gmw-xhrv-c9v3 | tinypool 1.1.1 | `>=2.1.1` | Vitest 3.2.7 depends on tinypool 1.x. Overriding to 2.x changes the test worker ABI. |
| GHSA-85c8-ppgw-ccpr | tinypool 1.1.1 | `>=2.1.2` | Same pin. |
| GHSA-82fw-gwwq-j7x9 | vitest 3.2.7 and mocker 3.2.7 | `>=4.1.11` | Vitest 4 is a new major. The current suite was verified on 3.2.7. |
| GHSA-qxg6-89mg-rqv8 | `@vitest/mocker` 3.2.7 | `>=4.1.12` | Ships with the Vitest 4 line. |

**Exposure:** development and CI test runs. Not the API, worker, or browser runtime.  
**Deadline:** 4 December 2026.  
**Proposed work:** upgrade the workspace to a Vitest 4 release that includes `@vitest/mocker` `>=4.1.12` and tinypool `>=2.1.2`, then re-run the full suite. Do that in its own change, not bundled into an unrelated feature.

### `@prisma/config` / deepmerge-ts

| Advisory | Installed | Patch | Why it was not applied |
|---|---|---|---|
| GHSA-ggr8-5vv4-36mx | deepmerge-ts 7.1.5 | `>=8.0.0` | 8.x is a major. `@prisma/config@6.19.3` depends on 7.1.5. An override can break Prisma config loading. Prisma 7 is a separate migration. |

**Exposure:** Prisma CLI configuration merge. Not a tenant request handler.  
**Deadline:** 4 December 2026.  
**Proposed work:** move when Prisma publishes a 6.x config package that depends on deepmerge-ts 8, or when the project plans the Prisma 7 upgrade. Do not override deepmerge-ts ahead of Prisma.

### ESLint 9 / minimatch

| Advisory | Installed | Patch | Why it was not applied |
|---|---|---|---|
| GHSA-g3hv-75wg-m249 | minimatch 3.1.5 and 10.2.6 | `>=11.0.1` | ESLint 9.39.5 and typescript-eslint 8.72.1 require the 3.x and 10.x lines. minimatch 11 changes the glob API. |

**Exposure:** `pnpm lint` and CI. Not the request path.  
**Deadline:** 4 December 2026.  
**Proposed work:** adopt the ESLint release that depends on minimatch `>=11.0.1`. `eslint@9.39.5` already prints a deprecation warning. Do not jump to ESLint 10 only to clear this advisory until the flat config and typescript-eslint peer range are checked.

## CI

`.github/workflows/ci.yml` installs with `pnpm install --frozen-lockfile`, then runs `pnpm db:setup`, lint, typecheck, test, `pnpm check:source`, the web production build, and `node scripts/check-audit.mjs`. PostgreSQL 16 and Redis 7 are service containers. `DATABASE_URL_WORKER` and `SALESOS_WORKER_PASSWORD` are set so the worker role exists before migrations. The audit step fails closed on an unknown advisory id and on an expired exception.
