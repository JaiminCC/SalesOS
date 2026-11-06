# Delivery investigation operations

Sprint 8 does not add a send path. Delivery lists, reconciliation, and investigation notes stay on the Sprint 7 records.

Gmail reconciliation still requires the stored provider message id and the `SENT` label. That label is not recipient delivery. Microsoft reconciliation still requires the immutable id and `isDraft = false`. HTTP 202 is not delivery. Subject matching is not used. An inconclusive attempt stays `DELIVERY_UNKNOWN`.

Reconciliation does not call a send endpoint. An uncertain attempt is not dispatched again. An investigation note records `HUMAN_INVESTIGATION` with `delivered: false` and does not change the provider result or release the reservation.

The Operations overview counts uncertain reservations for mailboxes the member can access. It reports sending as `SEND DISABLED`.
