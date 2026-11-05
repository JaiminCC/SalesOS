# Email reconciliation

`MAILBOX_RECONCILE_JOB` calls `reconcileSend`. It never calls a send API.

When live provider HTTP is disabled, or the attempt has no provider message id, or the connection is disconnected, or the token is missing, the job writes `RECONCILE_UNRESOLVED` with `retry: false` and `delivered: false`. The attempt is not resent.

When live HTTP is enabled:

- Gmail metadata is `SENT_ITEM_CONFIRMED` only if `labelIds` includes `SENT`. Any other 200, including a message that is not yet in Sent, is `DELIVERY_UNKNOWN`.
- Graph lookup is `SENT_ITEM_CONFIRMED` only when the returned id matches and `isDraft` is false. A draft, a 404, or a timeout stays unresolved.
- Lookup is skipped for the wrong mailbox when the connection is disconnected or the token cannot be read. A missing provider id is not matched by subject.

A Sent-folder or sent-item match is not recipient delivery. The product does not invent a provider receipt. Repeating reconciliation writes another event and does not send.

Capture webhook signatures can record an event. That event still has `sent: false` and does not move an attempt to `DELIVERY_CONFIRMED`.
