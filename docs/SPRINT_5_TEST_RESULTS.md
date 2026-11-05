# Sprint 5 test results

Commands were run on 5 November 2026 in this working tree. A command is listed as passed only when that process exited 0.

| Command | Result |
|---|---|
| `pnpm lint` | Failed once on four `@typescript-eslint/no-explicit-any` errors in `apps/api/src/crm/crm.service.ts`. After those annotations were replaced, `pnpm lint` exited 0. |
| `pnpm typecheck` | Passed. Prisma generate, package builds, and workspace typecheck all completed. |
| `pnpm test` | Passed. Shared 25, agent-core 6, integrations 1, database 15 (including the clean-database migration probe and forced RLS), API 34 (including `crm.integration.spec.ts`), worker 17 (including supervisor recovery), web secret scan. |
| `pnpm check:source` | Passed. |
| `NODE_ENV=production pnpm --filter @salesos/web build` | Passed. Next.js 15.5.29 compiled and generated the static pages. |
| `pnpm test:e2e` | The first run failed in 10 seconds because `PLAYWRIGHT_BROWSERS_PATH` pointed at an empty sandbox cache. The rerun with `PLAYWRIGHT_BROWSERS_PATH=$HOME/Library/Caches/ms-playwright` passed 6 tests: agents, auth, CRM, both management specs, and products. The CRM spec passed in 7.4 seconds inside that run. |

The CRM API test created two organizations. Organization A scored Northwind Logistics at 65/100 grade B against a published ICP of Logistics, US, and size `51-200`. A second qualification returned the same score. The other organization received 404 for that account and zero search hits. Import of a duplicate domain, a formula-prefixed cell, and a blank company name finished `PARTIAL`. The same idempotency key returned the same batch. The test discovery provider returned `live: false`. Suppression produced `SUPPRESSED`. After removal, an active takeover produced `HUMAN_OWNED`. Both eligibility responses had `externalSend: false`. A repeated archive id returned 400.

No Ollama call was made for lead qualification in these tests. The score above is the deterministic scorer, not a model opinion.
