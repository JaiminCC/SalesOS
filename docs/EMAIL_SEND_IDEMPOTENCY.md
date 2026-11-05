# Email send idempotency

A database transaction cannot commit a provider HTTP call. The sequence is:

1. Load the draft, current version, approval, connection, policy, reservations, and CRM facts.
2. If that version already has a dispatch reservation, or a prior attempt in `CAPTURED`, `IN_FLIGHT`, `PROVIDER_ACCEPTED`, `DELIVERY_UNKNOWN`, `ACCEPTED_BY_PROVIDER`, or `SENT_ITEM_CONFIRMED`, stop with `DUPLICATE_SEND`. Do not call the provider.
3. For a live allow, lock the policy row and insert `IN_FLIGHT` together with one `RESERVED` row. The idempotency key is `sha256(versionId + ':dispatch')`.
4. A concurrent insert that hits the unique attempt key or the unique reservation key returns `DUPLICATE_SEND`. It is an application result, not an uncaught `P2002`, and it does not call the provider.
5. Re-read the fence. On failure, settle `FAILED_FINAL` and `RELEASED` without calling the provider.
6. Call the provider outside the transaction.
7. Update the same attempt to `PROVIDER_ACCEPTED`, `FAILED_FINAL`, or `DELIVERY_UNKNOWN`, and the reservation to `ACCEPTED`, `RELEASED`, or `UNCERTAIN`.

`READY` is written when the gate would allow a send but the process has no provider function. `READY` is not a reservation, so a later authorized process can still claim the dispatch. A second click after the reservation exists cannot.

A definitive `REJECTED` result is `FAILED_FINAL` and releases capacity. It is not automatically retried. 429, 5xx, timeouts, and thrown network errors become `DELIVERY_UNKNOWN`, keep capacity, and are not automatically retried.

Changing the stored idempotency key does not create a second reservation. Two workers claiming the same version produce one provider call.

This is at-most-once automatic dispatch after the request may have left the process. It is not exactly-once delivery. Providers can accept a message and lose the response. That attempt stays unknown and is not sent again.
