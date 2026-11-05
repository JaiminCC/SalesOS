# Sprint 6 completion

**Verdict: PARTIAL.**

MAILBOX INTEGRATION — IMPLEMENTED. LIVE PROVIDER — NOT CONFIGURED. LIVE SEND — NOT IMPLEMENTED.

Capture import, threading, sanitized storage, drafts, human approval, and the send-time gate work and were tested. Google and Microsoft OAuth can start when a client id exists and can exchange a code when a client secret exists. No client credentials were configured here, so no live mailbox was connected and no live sync ran. `evaluateSendGate` does not return a live allow. Capture success stores `sent: false`.

Signed-in inbox uses `InboxDesk`. Signed-out inbox stays simulated. Sprint 7 was not started. Nothing was committed or pushed.

## What passed

- Provider catalog marks Google and Microsoft `NOT_CONFIGURED` without client ids. IMAP and SMTP are `NOT_IMPLEMENTED`. Capture is labeled and is not a live mailbox.
- OAuth state is hashed, redirects are allowlisted, and verifiers are encrypted. Token exchange is implemented and unit-tested with a stub `fetch`.
- Import deduplicates provider message ids, threads by provider id and RFC reply headers, and strips script markup.
- A second organization cannot read the mailbox or the thread. Mailbox access is per user.
- The draft author cannot approve. An edit returns the draft to `DRAFT` and revokes the prior approval.
- Send review on an unlinked recipient returns `sent: false` and does not use the label delivered.
- Worker SIGKILL during sync resumes after lease expiry without a duplicate message. Suspension and a revoked `mailbox.connect` permission stop the job.
- Existing Sprint 1–5 tests passed in the same `pnpm test` run.

## What remained after the first Sprint 6 pass

Those items are continued in Sprint 6.1. See `docs/SPRINT_6_1_COMPLETION.md`.

- Live Gmail and Microsoft Graph history were not connected in that pass. Sprint 6.1 wires the read-only sync and covers it with HTTP stubs. A consented mailbox was still not available.
- No Gmail, Graph, or SMTP send function. That remains true.
- The signed-in inbox now includes approvals and an analysis panel. Browser coverage is the mailbox Playwright spec.
- Inbox analysis has one recorded local model run. See `docs/REAL_INBOX_AI_ACCEPTANCE.md`.
- The fixed capture webhook secret was removed. See `docs/MAILBOX_CAPTURE_SECURITY.md`.

See `docs/SPRINT_6_TEST_RESULTS.md` for the original Sprint 6 command exit codes. Sprint 6.1 results are in `docs/SPRINT_6_1_COMPLETION.md`.
