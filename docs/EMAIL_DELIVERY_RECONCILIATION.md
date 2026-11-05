# Email delivery reconciliation

Send attempts use these stored states: `FAILED_FINAL` when the gate blocks, and `CAPTURED` when capture mode accepts the attempt. `sent` is false in both cases. `reconciliation` is the block reason or `CAPTURED_NOT_SENT`.

The gate does not return a live allow, so this sprint does not write `ACCEPTED_BY_PROVIDER`, `DELIVERED_IF_CONFIRMED`, or a provider delivery receipt from Gmail or Graph.

`reconcileSend` reads the attempt. It does not send again. A `DELIVERY_UNKNOWN` row stays unknown. Capture rows stay `CAPTURED_NOT_SENT`.

Idempotency is `sha256` of the draft version id and the gate state. A second send with the same version and state returns the stored row.

`mailbox.send` on the worker calls `sendDraft` with `liveEmailSendEnabled(process.env)`. In test and CI that function is false. A draft approval does not enqueue a send by itself. The send route and the worker both go through the same gate.

No CI test calls a paid provider or sends a real message.
