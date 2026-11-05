# Email delivery assurance

| State | Meaning |
|---|---|
| `READY` | Policy would allow a send, but this process did not call a provider. |
| `IN_FLIGHT` | The attempt and its `RESERVED` quota row are stored. The provider call may or may not have started. |
| `PROVIDER_ACCEPTED` | The provider returned a success status. Not proof the recipient received it. |
| `SENT_ITEM_CONFIRMED` | A later authorized lookup found the stored provider id in a sent state. Still not recipient delivery. |
| `DELIVERY_UNKNOWN` | The outcome could not be classified, or a previous call may have been accepted. |
| `FAILED_FINAL` | The gate or the pre-network fence blocked the send, or the provider rejected it. |
| `CAPTURED` | Capture mode recorded a local id. `sent` is false. |
| `DELIVERY_CONFIRMED` | Not written. These APIs do not provide recipient delivery evidence. |

The column `mailbox_send_attempts.sent` remains false for every path above. A human investigation writes `HUMAN_INVESTIGATION` with `delivered: false` and `providerStateUnchanged: true`. It does not move the attempt to a delivered state.

Quota capacity is held by `RESERVED`, `ACCEPTED`, and `UNCERTAIN` reservations. `RELEASED` does not count. `email_send_quotas.accepted_count` increases only for `PROVIDER_ACCEPTED`.

The worker does not hold a database transaction open across the provider call. The claim commits first. The fence is read again. Then the HTTP call runs. Those three steps are not atomic with the provider.
