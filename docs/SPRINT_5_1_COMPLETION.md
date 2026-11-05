# Sprint 5.1 completion

Sprint 5.1 hardens owner assignment, runs lead research through the existing supervisor, and records one real Ollama explanation. It does not start Sprint 6 and it does not send email or WhatsApp.

## What changed

- Migration `20261105170000_member_assignable` adds `member_is_assignable(uuid, uuid)`.
- Lead, account, and contact assignment, including bulk lead assignment, call that function.
- `planKind: LEAD_RESEARCH_AND_QUALIFY` stores and executes the nine `lead.*` tools.
- `qualification/run` with a model configuration starts that plan. Without one, it stores the deterministic score only.
- Discovery labels are `USER PROVIDED DATA` and `LOCAL TEST DATA`. External discovery returns `NOT_CONFIGURED`.
- The lead view separates the official score from the model explanation.
- Import error CSV cells are formula-neutralized.

## Verification already run while implementing

- `packages/shared` `crm.spec.ts`: 5 passed.
- `packages/database` `definer.spec.ts`: 4 passed.
- `apps/api` `crm.integration.spec.ts`: 1 passed. Score stayed 65. The fake-provider lead run executed all nine tools, stored usage, and created no action.
- `apps/api/src/crm/lead-model.acceptance.ts`: 1 passed in 13.2 seconds. Provider `ollama`, model `gemma4:e4b`, score 65, grade B. Buyer, trigger, and technology stayed `UNKNOWN`. No action was stored.

Validation on 5 November 2026: `pnpm lint` 0, `pnpm typecheck` 0, `pnpm test` 0 (shared 25, agent-core 6, integrations 1, database 15, API 34, worker 17, web secret scan), `pnpm check:source` 0, production web build 0, `pnpm test:e2e` 0 with 6 passed. The separate Ollama acceptance file passed 1 test. Details are in `docs/SPRINT_5_FINAL_ACCEPTANCE.md`.

## Not in this sprint

External discovery is not configured. Campaigns, mailbox sending, calendar, billing, and SSO were not implemented.
