# Sprint 5.2 completion

Sprint 5.2 hardens lead ownership, qualification explanations, CRM management, and worker recovery. It does not send messages and it does not start Sprint 6.

## Owner assignment

`lock_member_for_assignment` locks the tenant, user, and membership, then calls `member_is_assignable`. Assignment and membership removal share `pg_advisory_xact_lock(hashtextextended(tenant, 0))`. Organization status changes take that same advisory lock. When a membership, user, or organization leaves `ACTIVE`, open assignment history is ended and the current `owner_user_id` is cleared. `crm_takeovers` is not updated. `salesos_app` still cannot read `users` or execute `end_member_ownership`.

Concurrent tests in `packages/database/src/assignment-lock.spec.ts` cover removal, membership suspension, organization suspension, and bulk assignment against revocation. Each blocking update waits until the assignment transaction commits. The owner is then empty and the takeover stays active.

## Explanations

`lead.qualification.explain` must copy the official score, grade, and dimension fits and name those dimensions. One repair call is allowed. A score restatement, including "The official lead qualification score is 65, corresponding to a grade of B.", is `INSUFFICIENT_EXPLANATION`. Propose then stores the deterministic breakdown and leaves the qualification model fields empty. The score still comes from `scoreIcp`.

The fake provider used by `pnpm test` takes this path. The Logistics fixture stays 65 / B. Buyer, trigger, and technology stay `UNKNOWN`.

The saved Ollama configuration was called by `vitest.acceptance.config.ts`. The run recorded Ollama usage. The model payload was not accepted after repair, so the stored explanation is the deterministic breakdown, score 65, grade B, with those three dimensions `UNKNOWN`. That is not presented as a model analysis.

## CRM management

`LeadsDesk` remains the Sprint 3.1 management kit. Companies, contacts, and leads have add, view, and edit. Leads edit source reference and ICP name only. Suppression can be added and removed after confirmation. Imports, discovery jobs, duplicate review, assignment history, and qualification history can be viewed. They do not have an edit form. Lists use the server page, search, and sort endpoints. Navigation tokens keep database ids out of the URL. The existing two-tab company edit in `e2e/crm.spec.ts` still passes.

## Worker recovery

`apps/worker/src/crm-recovery.spec.ts` starts `crm-crash.ts` and sends `SIGKILL` after the first committed checkpoint for import, discovery, and qualification. A second delivery while the lease is current does not write. After the lease is expired, the job finishes once. Cancellation, tenant suspension, and permission revocation do not continue. Details are in `docs/CRM_WORKER_RECOVERY.md`.

## Discovery

Manual stays USER PROVIDED DATA. Test stays LOCAL TEST DATA. Both are `live: false`. `externalDiscoveryAdapter()` records the unconfigured contract. The screen shows `EXTERNAL DISCOVERY — NOT CONFIGURED`. No live provider was called.

## Commands

Run on 5 November 2026. The Ollama file is outside `pnpm test`.

| Command | Exit |
|---|---|
| `pnpm lint` | 0 |
| `pnpm typecheck` | 0 |
| `pnpm test` | 0 |
| `pnpm check:source` | 0 |
| `NODE_ENV=production pnpm --filter @salesos/web build` | 0 |
| `PLAYWRIGHT_BROWSERS_PATH=$HOME/Library/Caches/ms-playwright pnpm test:e2e` | 0 |
| `pnpm --filter @salesos/api exec vitest run --config vitest.acceptance.config.ts` | 0 |

`pnpm test` passed shared 29, agent-core 6, integrations 1, database 20, API 34, worker 21, and the web secret scan. Playwright passed 6 tests in 56.7s, including the CRM browser flow. The Ollama acceptance passed 1 test in 11.9s.
