# Sprint 7 security review

This review matches the code that was added for controlled outbound email. It is not a claim of legal compliance, and it is not a live penetration test.

## Threats and where they are stopped

| Threat | Mitigation | Test or control |
|---|---|---|
| Unauthorized send | `mailbox.send` and `mailbox.send.execute`, mailbox access rank `SEND` | Gate reason `SENDER_NOT_ALLOWED` |
| Read-only user sends | Read access rank is below `SEND`; read scope is not a send scope | OAuth URL test; `sendScopeGranted` |
| Tenant impersonation | `withTenant` and forced RLS; client tenant id is not the authority | `isolation.spec.ts` |
| From spoofing | From is the connection address | Adapter uses that address |
| Header injection | `headerSafe` rejects CR or LF | Gate `CONTENT_BLOCKED` |
| Approval replay | Decided row cannot be decided again; digest must match the current version | Existing 409; digest unit test |
| Edit after approval | New version, old hash no longer matches | API draft edit returns `DRAFT` |
| Recipient, cc, or bcc change | Included in `draftDigest` | Bcc digest test |
| Send after suppression, takeover, unknown consent, or quiet hours | Facts are read again in `sendDraft` | Gate reasons |
| Send after revocation | Disconnected connection fails the gate; tokens cleared on disconnect | Revocation version on sync; sending switch cleared |
| OAuth scope escalation | Send URL is explicit; token `scope` must contain the send scope before `SEND_AUTHORIZED` | `startSendOauth` |
| Token theft in API responses | Public connection omits ciphertext | Existing mailbox responses |
| Duplicate delivery | `IN_FLIGHT` stored first; later states are duplicates | `mailbox-send.spec.ts` |
| Timeout after accept | Thrown error becomes `DELIVERY_UNKNOWN` and the second call does not deliver | Same spec |
| Worker crash during HTTP | Row already `IN_FLIGHT`, so a new worker does not send | Same control |
| Provider response spoofing | No webhook is trusted as delivery | Capture webhook `sent: false` |
| AI prompt injection | Inbox prompt says mail text is untrusted and cannot authorize sending | `inboxAnalysisPrompt` |
| Attachment swap | Attachments are not sent | Status `NOT SUPPORTED` |
| Unbounded volume | Hourly cap and CRM frequency limits | `RATE_LIMIT` |
| Cross-tenant mailbox | RLS and `canAccess` | API other-tenant 404 |

## Residual risk

Sprint 7.1 closed the reservation race, the daily and recipient caps, and the Graph draft-id correlation. See `docs/SPRINT_7_1_SECURITY_REVIEW.md`.

- No live mailbox was available, so token refresh during a real send was not observed.
- Enabling the three flags in a future operation would allow the existing adapters to call Google or Microsoft. This review does not authorize that.

## Identity role

`salesos_identity` was not granted the new tables. `salesos_app` and `salesos_worker` can use `email_send_policies` and `email_send_quotas` inside tenant context. `salesos_app` still cannot select `users`.
