# Email integration architecture

Mailbox work is provider-specific at the edge and shared after a message is stored.

`packages/shared/src/mailbox.ts` declares capabilities, OAuth URL construction, HTML sanitizing, threading keys, draft digests, and `evaluateSendGate`. `packages/integrations/src/mailbox.ts` reads one Gmail page and exchanges an OAuth code when a caller supplies `fetch`. `packages/database/src/mailbox-work.ts` stores messages, drafts, approvals, and capture attempts. `apps/api/src/mailbox` exposes the management API. `apps/worker` runs `mailbox.sync` and `mailbox.send`. The signed-in screen is `InboxDesk`. The signed-out inbox stays simulated.

A capture mailbox is an explicit record with `provider: capture`, `live: false`, and the label `MOCK / CAPTURE MODE`. It is not a Gmail or Microsoft connection.

`evaluateSendGate` returns `BLOCK` or `CAPTURE`. Both set `sent: false`. A passing capture check records `CAPTURED` and `CAPTURED_NOT_SENT`. It does not record `DELIVERED`.

`SALESOS_LIVE_EMAIL_SEND_ENABLED` defaults to `false`. The API refuses `true` when `NODE_ENV` is `test` or `CI` is `true`. Even when the flag, the tenant, and a send scope are all on, the gate returns `LIVE_SEND_NOT_IMPLEMENTED`. No Gmail, Graph, or SMTP send function is called.

Tokens are AES-GCM ciphertext. API responses do not include them. Message HTML is sanitized before storage. Email text is data for the supervisor, not a tool-permission change.
