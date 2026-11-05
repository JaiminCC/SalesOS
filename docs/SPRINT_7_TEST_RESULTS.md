# Sprint 7 test results

Commands were run in this order. The production web build finished before Playwright started. Skipped tests are not listed as passed. No suite reported skipped tests.

| Command | Exit | Result |
|---|---|---|
| `pnpm lint` | 0 | ESLint clean |
| `pnpm typecheck` | 0 | Shared, agent-core, integrations, database, web, API, and worker |
| `pnpm test` | 0 | Counts below |
| `pnpm check:source` | 0 | Syntax and feature checks |
| `NODE_ENV=production pnpm --filter @salesos/web build` | 0 | Next.js 15.5.29 compiled |
| `PLAYWRIGHT_BROWSERS_PATH=$HOME/Library/Caches/ms-playwright pnpm test:e2e` | 0 | 8 passed in 1.1m |

## Unit and integration counts

| Package | Files | Tests |
|---|---|---|
| `@salesos/shared` | 8 | 33 |
| `@salesos/agent-core` | 4 | 6 |
| `@salesos/integrations` | 4 | 7 |
| `@salesos/database` | 7 | 21 |
| `@salesos/api` | 11 | 35 |
| `@salesos/worker` | 6 | 25 |
| `@salesos/web` | secret scan | PASS |

Database coverage included the fresh migration probe, forced RLS on every `tenant_id` table, and `mailbox-send.spec.ts` (one dispatch, no second provider call, uncertain send not retried). API mailbox coverage included capture `sent: false`, send status `SEND DISABLED`, and send-scope OAuth left `NOT_CONFIGURED`.

## Playwright

1. Agents
2. Auth and organizations
3. CRM without sending
4. Inbox capture does not claim a live send, including the Sending section and no `SEND NOW` button
5. Inbox links, drafts, approval, edit revocation, second tab, viewer denial
6. Management pages
7. Member removal
8. Product configuration and tenant isolation

## Not run

Local Ollama acceptance was not repeated in this session. The Sprint 4 record for `gemma4:e4b` is unchanged. This session did not call a model and does not add a new live-model pass.

Live Gmail and Microsoft calls were not made.
