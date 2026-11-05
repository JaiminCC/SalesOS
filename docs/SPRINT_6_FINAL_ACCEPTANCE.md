# Sprint 6 final acceptance

Sprint 6, 6.1, and 6.2 are in the working tree on top of `269fae6`. They were not committed and were not pushed. Sprint 7 was not started.

## Release decision

Local mailbox infrastructure — Verified

Real AI Inbox analysis — Verified

External mailbox integration — Not tested

Outbound delivery — Disabled

## What was verified

Local capture mailboxes, read-only sync fencing, drafts, human approval, approval invalidation, CRM linking, and the send gate were exercised by unit tests, the worker recovery spec, and Playwright. The signed-in inbox does not put database ids in the address bar.

One real Ollama run used `gemma4:e4b` at `127.0.0.1:11434`. The stored draft cited approved knowledge. The run created no lead and made no send attempt. The model name is the local model that was available, not a production default.

Google and Microsoft client ids and secrets are absent. No provider account was created. No live mailbox was connected. Stubbed HTTP in `provider-read.spec.ts` and `mailbox-recovery.spec.ts` is not a live Gmail or Microsoft verification.

`evaluateSendGate` returns `sent: false`. Requested OAuth scopes are `gmail.readonly` and `Mail.Read`. Send scopes stop a sync. The inbox shows `SEND DISABLED` and `LIVE SEND NOT CONFIGURED`.

## Exact results from this pass

| Check | Result |
|---|---|
| `pnpm lint` | exit 0 |
| `pnpm typecheck` | exit 0 |
| `pnpm test` | exit 0 |
| `pnpm check:source` | exit 0 |
| `NODE_ENV=production pnpm --filter @salesos/web build` | exit 0 |
| `pnpm test:e2e` with `PLAYWRIGHT_BROWSERS_PATH=$HOME/Library/Caches/ms-playwright` | exit 0, 8 passed |
| Ollama inbox acceptance | exit 0, 1 passed, 12.01s, `ollama` / `gemma4:e4b` |
| Live provider acceptance | not run |

Playwright:

- manages agents and runs without deleting history or putting ids in the url
- registers, verifies, and manages organizations in the browser
- manages live companies, imports, qualification, and eligibility without sending
- signed-in inbox uses capture mail and does not claim a live send
- inbox links, ownership, drafts, and a second tab stay inside the signed-in mailbox
- runs management pages without database ids in the address bar
- removes selected members and revokes another session
- configures a product and keeps another organization isolated

`pnpm test` summaries: shared 8 files / 33 tests, integrations 3 files / 5 tests, agent-core 4 files / 6 tests, database 6 files / 20 tests, API 11 files / 35 tests, worker 6 files / 25 tests, web secret scan pass.

## Migrations

Forward-only mailbox migrations, not edits of earlier migrations:

- `20261105190000_mailbox`
- `20261105203000_mailbox_read_sync`
- `20261105213000_mailbox_revocation` adds `mailbox_connections.revocation_version integer NOT NULL DEFAULT 0`

## Remaining limitations

- Live Gmail and live Microsoft 365 were not tested.
- IMAP and SMTP are not implemented.
- Attachment bodies are not downloaded.
- Outbound email and WhatsApp sending stay disabled.
- The capture webhook stays development-only.
- A page fetched from a stub is not evidence of a provider mailbox.

## Setup for a later live read-only check

1. Register an OAuth client in Google Cloud or an app registration in Microsoft Entra for a consented test mailbox. Do not commit the secret.
2. Set `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET`, or `MICROSOFT_OAUTH_CLIENT_ID` and `MICROSOFT_OAUTH_CLIENT_SECRET`.
3. Set the redirect URI to `/workspace/inbox` on an origin listed in `WEB_ORIGIN`.
4. Keep the scope at `gmail.readonly` or `Mail.Read`. Do not add a send scope.
5. Connect that mailbox, sync one bounded page, repeat the sync, and confirm the stored count, cursor, thread, read-only scope, and zero send attempts.

That check was not run in this workspace.
