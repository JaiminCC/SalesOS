# Gmail live verification

**LIVE GMAIL — NOT CONFIGURED.**

No Google OAuth client is configured in this workspace. No Gmail mailbox was connected. No Gmail request left this machine during Sprint 8.

Local evidence:

- Profile lookup, message list, bounded message bodies, and history id capture are covered by the provider stub.
- `users.history.list` uses the stored history id as `startHistoryId`. History ids are not treated as consecutive.
- HTTP 404 on a history cursor returns `expiredCursor` and list mode. The sync stores that reset before the next read.
- HTTP 401 and 403 become authentication or authorization errors. HTTP 429 is `RATE_LIMIT` and is retryable. HTTP 5xx and timeouts are provider unavailable or timeout. Redirects are rejected.
- A successful stub page is origin `STUB`, not `LIVE_READ_VERIFIED`.

A later live check follows `docs/REAL_MAILBOX_SYNC_VERIFICATION.md`. Do not request `gmail.send` for that check.
