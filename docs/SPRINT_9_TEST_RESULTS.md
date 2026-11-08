# Sprint 9 test results

Commands were run in order on 8 November 2026. Exit codes are the process status after the fixes in this working tree. Screenshot files under `docs/verification/` were restored with `git checkout` after Playwright.

| Command | Exit |
|---|---|
| `pnpm lint` | 0 |
| `pnpm typecheck` | 0 |
| `pnpm test` | 0 |
| `pnpm check:source` | 0 |
| `NODE_ENV=production pnpm --filter @salesos/web build` | 0 |
| `PLAYWRIGHT_BROWSERS_PATH=$HOME/Library/Caches/ms-playwright pnpm test:e2e` | 0 |

`pnpm test` passed shared 38, agent-core 6, integrations 7, database 25, API 36, and worker 29. The web step passed the secret scan. Database coverage includes the clean migration probe, forced RLS isolation, campaign preparation, the 501-lead `AUDIENCE_LIMIT` refusal, and the no-send source scan. API coverage includes `campaign.integration.spec.ts`. Worker coverage includes `campaign-kill.spec.ts`.

`pnpm test:e2e` passed 9 tests. `e2e/campaign.spec.ts` creates a campaign, previews a segment, saves a sequence, publishes the version, opens a second tab, checks analytics, confirms no send control, and checks a second organization. An earlier full run failed on the sequence publish click and was fixed before this passing run.

Ollama acceptance, run separately:

`pnpm --filter @salesos/api exec vitest run --config vitest.acceptance.config.ts src/campaigns/campaign-model.acceptance.ts`

Exit 0. The saved local model was `gemma4:e4b`. The run recorded Ollama usage for that model. The accepted draft status was `DRAFT_PREPARED`, the body contained the recorded company name, revenue was not invented, no recipient draft was approved, and `mailbox_send_attempts` for that organization stayed 0.
