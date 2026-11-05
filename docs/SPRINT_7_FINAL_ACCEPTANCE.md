# Sprint 7 final acceptance

## Definition of done

| Item | Result |
|---|---|
| Gmail send adapter | Implemented, stub tested |
| Graph send adapter | Implemented, stub tested, 202 does not invent a message id |
| Send scope is explicit | Yes |
| Read access does not imply send | Yes |
| Deployment, tenant, and mailbox flags default off | Yes |
| Review is separate from execute | Yes |
| Approval is bound to the version digest | Yes |
| Edit invalidates that approval | Yes, new version |
| Approval replay rejected | Existing `ALREADY_DECIDED` |
| Human action required | Gate; UI has no `SEND NOW` while disabled |
| Send-time recheck | Yes, inside `sendDraft` |
| Suppression, takeover, unknown consent, quiet hours, suspension, revocation | Block in the gate |
| Attempts persisted before HTTP | `IN_FLIGHT` |
| Acceptance is not called delivery | `sent` stays false |
| Duplicate dispatch prevented | Database test |
| Uncertain outcome not retried | Database test |
| Reconciliation | Records unresolved or Sent Item confirmed; does not resend |
| Quotas | Hourly, daily, tenant-daily, user-hourly, and recipient caps enforced by reservations |
| Delivery history UI | Sending and Delivery screens show state, reservation, reconciliation, and investigation notes |
| Cross-tenant tests | Existing isolation and mailbox 404, including `email_send_reservations` |
| Worker crash | Child-process SIGKILL around a local provider, with no second call when acceptance may have occurred |
| Sprint 1–6 tests | Must stay green in `docs/SPRINT_7_TEST_RESULTS.md` |
| Playwright | Inbox expectations extended |
| Docs match the code | Yes |

## Separate acceptance

Live mailbox: **NOT TESTED**.

Real outbound delivery: **NOT AUTHORIZED**.

Stub testing is not `LIVE_VERIFIED`.

## Sprint 7.1

Sprint 7.1 is recorded in `docs/SPRINT_7_1_COMPLETION.md`. Daily and recipient caps are enforced. Uncertain attempts keep capacity. Duplicate requests return `DUPLICATE_SEND`. Authorization is fenced before HTTP, and that fence is not atomic with the provider. Gmail and Graph outcomes stay stub tested. Unknown deliveries are not retried. SIGKILL recovery passed. The management UI shows send state and does not offer `SEND NOW` while the deployment gate is off.

## Release status

CLOSED-GATE SENDER — PASS

GMAIL ADAPTER — STUB_TESTED

GRAPH ADAPTER — STUB_TESTED

LIVE MAILBOX — NOT TESTED

LIVE EMAIL DELIVERY — NOT AUTHORIZED

## Residual limitations

- Graph identifier stability after send is not live verified. A changed id stays unresolved.
- A Sent Items or sent-label match is not proof of recipient delivery.
- Attachments are unsupported.
- Uncertain attempts are not automatically resent.
- There is no live provider acceptance evidence. Stub success is not `LIVE_VERIFIED`.

## Verdict

**CLOSED-GATE SENDER — PASS.** This is not a pass for live mailbox connectivity or live email delivery.
