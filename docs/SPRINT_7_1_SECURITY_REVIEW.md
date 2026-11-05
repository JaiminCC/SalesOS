# Sprint 7.1 security review

This review matches the quota, fence, reconciliation, and crash-recovery code. It is not a live penetration test and it does not authorize sending.

## Controls

| Threat | Control |
|---|---|
| Cross-tenant quota or attempt read | `email_send_reservations` has forced row-level security and `tenant_isolation`. `isolation.spec.ts` includes the table. |
| Broad grants | `SELECT`, `INSERT`, `UPDATE`, and `DELETE` go to `salesos_app` and `salesos_worker` only. `salesos_identity` is not granted the table. |
| Client quota override | The policy API accepts `enabled` and `killSwitch` only. Send requests have no cap fields. Defaults stay 20 hourly, 100 daily, 100 tenant daily, 10 user hourly, and 5 recipients. |
| Concurrent over-send | The policy row is locked with `FOR UPDATE` before the holding-state count. Two drafts under a one-slot cap produced one provider call. |
| Uncertain retry | `UNKNOWN` and thrown calls stay `UNCERTAIN` and keep capacity. A later send of that version is `DUPLICATE_SEND`. |
| Rejected capacity | `REJECTED` becomes `RELEASED` and does not count. The version slot remains, so that approval is not dispatched again. |
| Duplicate dispatch | Unique `(tenant_id, draft_version_id)` and `(tenant_id, idempotency_key)`. A parallel unique violation returns `DUPLICATE_SEND` instead of an uncaught `P2002`. |
| Stale authorization | Claim stores `revocation_version`, `policy_revision`, and `payload_digest`. The fence re-reads them, plus permissions, scope, kill switch, tenant activity, suppression, takeover, consent, verification, and quiet hours, before HTTP. |
| Impossible atomicity | The fence read and the provider call are separate. A revocation after transmission cannot retract the request and does not authorize a second send. |
| Approval binding | The digest must match the current version. Revoking the approval after the claim returns `APPROVAL_MISMATCH` and does not call the provider. The author still cannot approve their own draft. |
| Recipient policy | To, Cc, and Bcc are normalized together. Repeats count once. Invalid addresses block the message. The count is checked against `max_recipients`. |
| Forged From | The provider payload uses the connection address. |
| Token exposure | Ciphertext stays out of the delivery and connection responses. Reconciliation decrypts only inside the worker path that already holds the key. |
| Scope | Google requires `gmail.send`. Microsoft requires `Mail.Send`. The test provider is not live. Changing a claimed connection to a read-only Google scope stopped the call. |
| Reconciliation resend | Lookup never calls send. Gmail requires the `SENT` label. Graph requires the same id and `isDraft === false`. Neither result sets `sent` or `DELIVERY_CONFIRMED`. |
| Human delivered mark | Investigation writes `HUMAN_INVESTIGATION` with `delivered: false` and `providerStateUnchanged: true`. The UI says the provider result is unchanged. |
| Autonomous send | No new agent send tool. `sendNow` stays false. The Inbox has no `SEND NOW` control while the deployment gate is off. |
| Real delivery | `SALESOS_LIVE_EMAIL_SEND_ENABLED` is unset. `NODE_ENV=test` and `CI=true` cannot enable it. Tests use stubs and `127.0.0.1`. |

## Residual risk

- The database cannot roll back a provider request that has already been transmitted.
- Graph immutable-id stability after send is stub tested. It is not confirmed on a live tenant. A changed id stays `DELIVERY_UNKNOWN`.
- A Sent item or a non-draft Graph message is not recipient delivery.
- A released reservation still occupies the approved version, so that version cannot be dispatched later. A new version requires a new approval.
- There is no time-based send lease. Expiry is not treated as proof the provider did not accept.
- No live mailbox was available. Token refresh during a real send was not observed.
- Turning on the deployment, tenant, and mailbox flags later would let the adapters call Google or Microsoft. This review does not authorize that.
