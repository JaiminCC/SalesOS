# Sprint 8 test results

Commands were run in this order on 5 November 2026. Ollama acceptance was not run. Sprint 8 does not change the model gateway, and a skipped model check is not counted as a pass.

| Command | Exit |
|---|---|
| `pnpm lint` | 0 |
| `pnpm typecheck` | 0 |
| `pnpm test` | 0 |
| `pnpm check:source` | 0 |
| `NODE_ENV=production pnpm --filter @salesos/web build` | 0 |
| `PLAYWRIGHT_BROWSERS_PATH=$HOME/Library/Caches/ms-playwright pnpm test:e2e` | 0 |

`pnpm test` reported shared 34, agent-core 6, integrations 7, database 22, API 35, worker 28, and the web secret scan PASS. Database includes the clean migration probe and `mailbox-evidence.spec.ts`. Worker includes `mailbox-kill.spec.ts` (2) and `mailbox-recovery.spec.ts` (4).

Sprint 8.1 repeated the same command sequence on 6 November 2026. Every command exited 0. Playwright again reported 8 passed in 1.2m. The verification screenshots were restored afterward. The database run includes the clean migration probe and forced row-level security tests. The worker run includes mailbox process recovery and outbound process-kill recovery. The mailbox recovery assertion checks that a stubbed Gmail page is stored as origin `STUB` and not `VERIFIED`.

Playwright reported 8 passed in 1.2m. The signed-in inbox test opens Operations and sees `LIVE GMAIL — NOT CONFIGURED`, `LIVE MICROSOFT — NOT CONFIGURED`, `REAL READ-ONLY SYNC — NOT TESTED`, and no `SEND NOW` control.

`pnpm db:migrate` had already applied `20261106013000_mailbox_operations` to the local `salesos` database. Playwright global setup applies the same migration to a fresh `salesos_e2e` database.

Playwright rewrote five files under `docs/verification/`. Those files were restored with `git checkout -- docs/verification` and are not part of the Sprint 8 change.
