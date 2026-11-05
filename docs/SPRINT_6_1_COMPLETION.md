# Sprint 6.1 completion

**Verdict: PARTIAL.**

MAILBOX READ SYNC — IMPLEMENTED AND STUB-TESTED. LIVE PROVIDER — NOT TESTED. INBOX INFERENCE — PASS. LIVE SEND — NOT IMPLEMENTED.

Sprint 6.1 finishes the read-only Gmail and Microsoft Graph sync path, replaces the fixed capture webhook secret, and runs one real local inbox analysis. It does not send mail and it does not start Sprint 7.

## Matrix

| Area | Result |
|---|---|
| Capture webhook disabled by default, production refusal, HMAC, replay, other-tenant body, no delivered status | PASS |
| Gmail OAuth state, refresh, history, pagination, rate limit, expired cursor | PASS against HTTP stubs |
| Live Gmail mailbox | NOT TESTED |
| Microsoft Graph OAuth, delta, conversation threading, foreign delta URL | PASS against HTTP stubs |
| Live Microsoft mailbox | NOT TESTED |
| Worker lease, SIGKILL after provider claim, duplicate prevention | PASS |
| Inbox analysis on stored mail with approved knowledge | PASS, one Ollama run |
| No automatic lead, no consent from receiving mail, no outbound send | PASS |
| Signed-in inbox management screens | PARTIAL. List, add, view, edit, approvals, and delivery are present. Playwright covers labels, capture create, section navigation, and the absence of database ids in the URL. |
| Live send | NOT IMPLEMENTED |

## Capture webhook

See `docs/MAILBOX_CAPTURE_SECURITY.md`.

## Provider sync

`readProviderPage` lists Gmail messages and then follows `historyId`. Microsoft Graph uses a delta query and `conversationId`. The worker jobs are `mailbox.sync`, `mailbox.incremental_sync`, and `mailbox.reconcile`. See `docs/REAL_MAILBOX_SYNC_VERIFICATION.md` and `docs/MAILBOX_SYNC_ENGINE.md`.

## Inbox analysis

`INBOX_ANALYZE_AND_DRAFT` uses the existing supervisor. The draft, citations, model, and usage are stored. See `docs/REAL_INBOX_AI_ACCEPTANCE.md`.

## Migration

`packages/database/prisma/migrations/20261105203000_mailbox_read_sync/migration.sql` adds `lookup_capture_connection` and `list_due_mailbox_connections`. It was applied to the local `salesos` database. It does not rewrite older mailbox rows.

## Validation

Command exit codes from 5 November 2026:

| Command | Exit |
|---|---|
| `pnpm lint` | 0 |
| `pnpm typecheck` | 0 |
| `pnpm test` | 0 |
| `pnpm check:source` | 0 |
| `NODE_ENV=production pnpm --filter @salesos/web build` | 0 |
| `PLAYWRIGHT_BROWSERS_PATH=$HOME/Library/Caches/ms-playwright pnpm test:e2e` | 0 |
| Ollama inbox acceptance | 0 |

The Ollama acceptance is not part of `pnpm test`.

## Remaining limitations

- No consented Google or Microsoft mailbox was configured.
- IMAP and SMTP remain unimplemented.
- Approval does not send. There is no Gmail, Graph, or SMTP sender.
- Quiet hours, suppression, consent, and verification still block an unlinked recipient.
- A full production penetration test was not run.

## Sprint 7 prerequisites

Sprint 7 is not started. Before any live send work, a consented read-only mailbox should complete the check in `docs/REAL_MAILBOX_SYNC_VERIFICATION.md`, and a separate send design should keep human approval, exact draft digest, and `sent: false` until a provider send implementation exists. Do not treat a stub as that mailbox.
