# Sprint 8 completion

Sprint 8 adds Communication Operations on the existing Inbox desk, the existing read-only sync engine, and the existing delivery records. Live sending was not enabled. No email was transmitted. No Google or Microsoft account was created.

## What shipped

- Provider readiness is `NOT_CONFIGURED`, `CONFIGURATION_INVALID`, or `CONFIGURED_UNVERIFIED`. It is separate from mailbox health and from live-read verification.
- Connection health and health history are stored. Capture health is `CAPTURE`.
- Sync runs, provider errors, in-app alerts, and server-owned verification rows are stored. Cursors in list views are fingerprinted.
- A page with a remaining provider link is `SYNC_PARTIAL`. An unsafe Graph link is an expired cursor, not a completed sync.
- Operators can request a read-only sync, pause or resume it, acknowledge an alert, and recover an expired cursor. Each destructive action asks for confirmation. None of them send mail.
- Unexpected send scopes still block sync and leave `sending_enabled` false.

## What did not ship

LIVE GMAIL — NOT CONFIGURED. LIVE MICROSOFT — NOT CONFIGURED. REAL READ-ONLY SYNC — NOT TESTED. No OAuth client secret is present, so no live login was attempted and no stub was labeled `LIVE_READ_VERIFIED`.

Live outbound delivery remains out of scope. Sprint 9 was not started.
