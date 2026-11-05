# Sprint 7 implementation plan

Sprint 7 adds controlled outbound email on the Sprint 6 mailbox. It does not replace capture, drafts, approvals, or the read-only sync path. Live sending stays off.

| Requirement | UI | API | Database | Worker | Permission | Test |
|---|---|---|---|---|---|---|
| Read versus send capability | Inbox Sending section, mailbox `sendCapability` | `mailboxes/get`, `mailboxes/oauth/send-start` | `mailbox_connections.send_capability` default `READ_ONLY` | Send job does not run while the deployment flag is off | `mailbox.read` does not grant send | Shared OAuth URL test; API send-start stays unconfigured |
| Separate send consent | No send button while disabled | `mailboxes/oauth/start` is read-only; `mailboxes/oauth/send-start` asks for `gmail.send` or `Mail.Send` | OAuth state row; capability becomes `SEND_REQUESTED` only when a connection id is supplied and a URL exists | None | `mailbox.connect` versus `mailbox.send.request` | `mailbox.spec.ts` scope strings |
| Exact draft approval | Draft edit says the approval was revoked | Existing `drafts/save`, `drafts/submit`, `email-approvals/decide` | `mailbox_draft_versions.body_sha256`, `mailbox_approvals.payload_sha256` | None | Author cannot hold `mailbox.review` for their own draft | API author 403; digest changes when Bcc changes |
| Send-time eligibility | Status text, not a live send button | `email-send/run` | Policy, quota, CRM suppression, takeover, quiet hours | Rechecks inside `sendDraft` before HTTP | `mailbox.send` and `mailbox.send.execute` | Gate unit tests; database dispatch test |
| Explicit human send | `SEND NOW` is absent while `sendNow` is false | `email-send/run` | Attempt row | `MAILBOX_SEND_JOB` calls `sendDraft` only for an already requested draft | `mailbox.send` | Playwright has no `SEND NOW` button |
| Provider dispatch | Delivery list | Adapters in `packages/integrations` | `IN_FLIGHT` row before HTTP | Provider function passed only when `liveEmailSendEnabled` is true | Connection `SEND` access | Gmail and Graph stub tests; one database dispatch |
| Acceptance is not delivery | Labels `PROVIDER ACCEPTED`, `DELIVERY UNKNOWN` | `delivery/list`, `delivery/reconcile` | `sent` stays false | Reconcile does not resend | `mailbox.read` | Database test `sent: false`; Graph 202 has a null message id |
| Quotas | Not a separate screen; blocks inside the gate | Policy caps on `email_send_policies` | `email_send_quotas` | Increment only after `PROVIDER_ACCEPTED` | `mailbox.send.manage` for the policy | Gate `RATE_LIMIT` |
| Tenant isolation | Navigation tokens, no ids in the URL | Existing management auth | Forced RLS on the two new tables | Tenant id comes from the outbox row | Membership | `isolation.spec.ts` includes the new tables |

## Activation

All three must be true before a provider function is allowed to run, and a person must still call send:

1. `SALESOS_LIVE_EMAIL_SEND_ENABLED=true`, and the process is not `NODE_ENV=test` and not `CI=true`.
2. `email_send_policies.enabled=true` and `kill_switch=false`.
3. Mailbox `sending_enabled=true` and `send_capability=SEND_AUTHORIZED` with a granted send scope.

This implementation does not turn any of those on.

## Out of scope

Bulk campaigns, automatic follow-up, WhatsApp, generic SMTP, attachment sending, and an agent tool that sends mail. Sprint 8 is not started.
