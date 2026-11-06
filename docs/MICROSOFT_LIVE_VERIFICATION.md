# Microsoft live verification

**LIVE MICROSOFT — NOT CONFIGURED.**

No Microsoft OAuth client is configured in this workspace. No Graph mailbox was connected. No Graph request left this machine during Sprint 8.

Local evidence:

- The inbox delta query uses the provider-returned `@odata.nextLink` or `@odata.deltaLink` unchanged after validation.
- Allowed links are HTTPS, host `graph.microsoft.com`, port empty or 443, no username or password, and a path under `/v1.0/`.
- A foreign host, userinfo, or unexpected port is not fetched. A bad link returned by the provider is an expired cursor, not a completed sync.
- HTTP 410 and `SyncStateNotFound` recover the delta cursor. HTTP 429 stays a rate limit. HTTP 401 and 403 stay authentication or authorization failures.
- `conversationId` is the thread key. A stub page is origin `STUB`.

A later live check follows `docs/REAL_MAILBOX_SYNC_VERIFICATION.md`. Do not request `Mail.Send` for that check. Graph identifier stability after send remains unverified from Sprint 7.
