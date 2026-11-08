# WhatsApp worker recovery

`processWhatsAppIngress` checkpoints at `before-receipt`, `after-receipt`, `during-message`, `after-message`, `during-link`, `after-link`, `during-draft`, `after-draft`, and `during-status`. The kill test uses `before-receipt` and `during-message`.

A kill before the ingress insert leaves no receipt. A kill inside the message transaction rolls the message back. The replacement worker inserts one message and one draft. A second run does not insert another message or draft. A suspended tenant stops before the write. The worker job throws on suspension or revoked permission and leaves the outbox pending. BullMQ retries that job at most five times. Outbound message count stays zero. An older `sent` status does not replace a stored `delivered` status.

The worker does not import the Cloud API send function. Retries use the database unique keys, not only Redis.
