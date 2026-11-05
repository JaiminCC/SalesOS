# Sprint 6 test results

Commands were run in this workspace on 5 November 2026. Exit codes are from those runs.

| Command | Exit |
|---|---|
| `pnpm lint` | 0 |
| `pnpm typecheck` | 0 |
| `pnpm test` | 0 |
| `pnpm check:source` | 0 |
| `NODE_ENV=production pnpm --filter @salesos/web build` | 0 |
| `PLAYWRIGHT_BROWSERS_PATH=$HOME/Library/Caches/ms-playwright pnpm test:e2e` | 0 |

`pnpm test` includes the clean-database migration probe, RLS isolation, mailbox integration, OAuth redirect rejection, capture import, draft approval, capture delivery with `sent: false`, and the mailbox SIGKILL recovery spec. Shared mailbox tests: 3 passed. Integrations mailbox tests: 2 passed. Database: 20 passed, including migration probe and isolation. API: 35 passed, including `mailbox.integration.spec.ts`. Worker: 23 passed, including `mailbox-recovery.spec.ts` (2). Web secret scan passed.

Playwright: 7 passed. The mailbox spec signs in, opens AI Conversations, checks `SEND DISABLED`, `Google Workspace: NOT CONFIGURED`, and `LIVE SEND NOT CONFIGURED`, creates a capture mailbox, and checks that the URL has no database id. Verification screenshots overwritten by Playwright were restored with `git checkout` of `docs/verification/signed-in.png`, `users.png`, `roles.png`, `audit.png`, and `restricted-invite.png`.

Not executed:

- Ollama inbox analysis. No live model run is claimed.
- Level 3 authorized Google or Microsoft mailbox. LIVE PROVIDER — NOT TESTED.
- Level 4 live send. LIVE SEND — NOT CONFIGURED. No CI test sends mail.
