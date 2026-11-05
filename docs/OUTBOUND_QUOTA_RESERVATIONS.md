# Outbound quota reservations

Sprint 7.1 adds `email_send_reservations`. The migration is `20261105233000_send_quota_fence`. The table is tenant scoped, forced row-level security, and granted to `salesos_app` and `salesos_worker`.

Each live dispatch inserts the `IN_FLIGHT` attempt and one `RESERVED` row in the same transaction, after the policy row lock. The reservation is unique on `(tenant_id, draft_version_id)` and `(tenant_id, attempt_id)`. A second dispatch of that approved version does not create another reservation.

## States

| State | Counts against caps | When it is written |
|---|---|---|
| `RESERVED` | Yes | Claim succeeds, before the provider call |
| `ACCEPTED` | Yes | Provider result is `ACCEPTED` |
| `RELEASED` | No | Provider result is `REJECTED`, or the pre-network fence fails |
| `UNCERTAIN` | Yes | Provider result is `UNKNOWN`, or the call throws |

`sent` stays false in every state.

A fence failure or a provider rejection still leaves the reservation row. The unique version key means that approved version is not dispatched again. That is intentional: a revoked unstarted intent must not be sent later. Capacity is released so a different approved version can use it.

An uncertain reservation keeps both the version slot and the capacity. Reconciliation does not send and does not change the reservation to `ACCEPTED` merely because a Sent item was found. Finding the Sent item records `SENT_ITEM_CONFIRMED` on the attempt reconciliation field. It is not recipient delivery and it is not a new reservation.

Duplicate clicks, a second queue delivery, and a different idempotency key for the same version all stop on the reservation. They do not call the provider.
