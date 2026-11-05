# Sprint 7.1 completion

Sprint 7.1 adds outbound quota reservations, a second authorization fence before the provider call, Gmail and Graph reconciliation rules, process-kill recovery, and the sending management screen. Live sending stays off. No Sprint 8 work was started. Nothing was committed or pushed.

## What changed

- Migration `20261105233000_send_quota_fence` adds reservation rows, policy revision, user and tenant caps, and the attempt fence columns. `20261105220000_email_send` was not edited.
- `sendDraft` locks the policy, reserves capacity with the `IN_FLIGHT` claim, and rechecks authorization before HTTP.
- Repeated To, Cc, and Bcc addresses count once. Invalid addresses block the send. Defaults remain 20, 100, 100, 10, and 5.
- A parallel unique violation returns `DUPLICATE_SEND`.
- Gmail reconciliation requires the `SENT` label. Graph creates a draft with `Prefer: IdType="ImmutableId"`, keeps that id, and confirms only when lookup returns the same id with `isDraft` false.
- `apps/worker/src/send-recovery.spec.ts` kills a child process with `SIGKILL` around a local capture server.
- Inbox Sending shows caps and reservation counts. Delivery lists are paginated. An investigation note cannot mark a message delivered. There is no `SEND NOW` control.

## Local validation on 5 November 2026

| Command | Result |
|---|---|
| `pnpm lint` | Exit 0 |
| `pnpm typecheck` | Exit 0 |
| `pnpm test` | Exit 0. Shared 33, agent-core 6, integrations 7, database 21, API 35, worker 26, web secret scan PASS |
| `pnpm check:source` | Exit 0 |
| `NODE_ENV=production pnpm --filter @salesos/web build` | Exit 0 |
| `PLAYWRIGHT_BROWSERS_PATH=$HOME/Library/Caches/ms-playwright pnpm test:e2e` | Exit 0. 8 passed in 1.2m |

Database 21 includes the clean migration probe, forced RLS isolation, and `mailbox-send.spec.ts`. Worker 26 includes `send-recovery.spec.ts`. Playwright includes both inbox specs. Screenshot files under `docs/verification` that the browser run rewrote were restored.

`SALESOS_LIVE_EMAIL_SEND_ENABLED` is unset. No Gmail or Graph sender was called. Ollama was not re-run.

## Verdict

**CLOSED-GATE SENDER — PASS.** Gmail and Graph adapters are **STUB_TESTED**. Live mailbox remains **NOT TESTED**. Live email delivery remains **NOT AUTHORIZED**.
