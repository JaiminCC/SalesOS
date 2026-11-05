# Sprint 5 final acceptance

Completed after Sprint 5.2. Counts are from the commands at the bottom. Skipped tests are not counted as passed. The Ollama acceptance is outside `pnpm test`.

## Acceptance matrix

| Requirement | Result |
|---|---|
| Assignment lock shared with membership removal and organization suspension | PASS |
| Revoked, suspended, and removed members are not actionable owners | PASS |
| Bulk assignment against revocation clears both leads | PASS |
| Human takeover is not changed by owner removal | PASS |
| `salesos_app` cannot read `users` or execute `end_member_ownership` | PASS |
| Official score stays deterministic (fixture 65 / B) | PASS |
| Unknown dimensions stay `UNKNOWN` | PASS |
| Score-only model text is `INSUFFICIENT_EXPLANATION` | PASS |
| Deterministic breakdown is stored when the model explanation is inadequate | PASS |
| Saved Ollama model was called and did not change 65 / B | PASS |
| Companies, contacts, and leads have add, view, and edit | PASS |
| Suppression, imports, discovery, duplicates, assignments, and qualification history are viewable | PASS |
| Immutable history has no edit form | PASS |
| Server pagination, search, and sort | PASS |
| Confirmation before archive, suppression removal, and duplicate merge | PASS |
| Database ids stay out of browser URLs | PASS |
| Two-tab company edit | PASS |
| `crm.import` SIGKILL recovery, lease, and no duplicate accounts | PASS |
| `crm.discovery` SIGKILL recovery and no duplicate candidates | PASS |
| `crm.qualify` SIGKILL recovery and no duplicate qualification history | PASS |
| Cancellation, tenant suspension, and permission revocation stop CRM jobs | PASS |
| Manual discovery labeled USER PROVIDED DATA | PASS |
| Test discovery labeled LOCAL TEST DATA | PASS |
| External discovery | NOT CONFIGURED |
| Tenant RLS, HMAC suppression, encryption, quiet hours, and no send path | PASS |
| Forward migration only | PASS |

## Commands

Run on 5 November 2026.

| Command | Exit | Result |
|---|---|---|
| `pnpm lint` | 0 | ESLint completed with no errors |
| `pnpm typecheck` | 0 | Prisma generate, package builds, and workspace typecheck completed |
| `pnpm test` | 0 | shared 29, agent-core 6, integrations 1, database 20, API 34, worker 21, web secret scan passed |
| `pnpm check:source` | 0 | Source syntax and feature checks passed |
| `NODE_ENV=production pnpm --filter @salesos/web build` | 0 | Next.js 15.5.29 production build completed |
| `pnpm test:e2e` | 0 | Playwright 6 passed in 56.4s (agents, auth, crm, two management, products) |
| `vitest run --config vitest.acceptance.config.ts` | 0 | 1 passed in 10.3s. Score 65, grade B. Stored explanation is the deterministic breakdown and `explanationSource` is `deterministic` |

`pnpm test:e2e` used `PLAYWRIGHT_BROWSERS_PATH=$HOME/Library/Caches/ms-playwright`. Verification screenshots overwritten by the auth flow were restored with `git checkout`.

## Verdict

Sprint 5 is accepted for the implemented lead-intelligence scope. External discovery is not configured, and no outbound send path exists. Those are the boundaries for Sprint 6, not open defects in this sprint.

## Sprint 6 prerequisites

Do not start these in Sprint 5:

- A licensed external discovery credential and one real provider response
- Mailbox connection and an approved send path
- Campaigns, calendar booking, billing, and SSO
- A model explanation that satisfies the schema on the saved local model, if a useful analysis is required before send
