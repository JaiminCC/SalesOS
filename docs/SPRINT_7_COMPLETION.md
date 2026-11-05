# Sprint 7 completion

Controlled outbound email is implemented behind closed gates.

## What landed

- Forward migration `20261105220000_email_send`.
- Gmail and Graph send adapters with stub tests. Capability `STUB_TESTED`.
- Send-scope OAuth that is separate from read-only OAuth.
- Permissions `mailbox.send.request`, `mailbox.send.execute`, `mailbox.send.review`, and `mailbox.send.manage`.
- Exact digest includes cc, bcc, HTML, purpose, and thread reference.
- `sendDraft` rechecks eligibility, writes `IN_FLIGHT` before HTTP, and does not retry `DELIVERY_UNKNOWN` or `PROVIDER_ACCEPTED`.
- Tenant policy, kill switch, and mailbox sending switch. All default off.
- Inbox Sending section. No `SEND NOW` control while the server reports sending disabled.
- The agent registry did not gain a send tool.

## What did not happen

- No live Gmail or Microsoft mailbox was connected.
- No real email was sent.
- The deployment flag was not enabled.
- Sprint 8 was not started.
- The work was not committed.

## Verdict

Implementation of the closed-gate sender is complete for levels 1 and 2. Live mailbox sync is not tested. Live sending is not authorized. See `docs/SPRINT_7_FINAL_ACCEPTANCE.md`.
