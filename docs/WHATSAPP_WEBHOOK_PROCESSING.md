# WhatsApp webhook processing

After a valid signature, each message or status becomes one ingress row keyed by the phone id, kind, message id, and status. A duplicate key is acknowledged and does not create another receipt. A mapped event also writes a tenant receipt and an outbox row in the same tenant transaction. The HTTP response is 200 only after that commit. If the commit fails, the response is not success.

`whatsapp.webhook.process` reads the receipt and writes the conversation, message, consent, contact link, and draft. Unique keys stop a retry from duplicating them. Media types are stored as `DEFERRED` without downloading the file. Text, button ids, and interactive reply ids are stored. The body limit is 4,000 characters.

Processing does not run a model inside the public request. `events/process` and the worker run the durable job. A suspended tenant or a revoked permission returns before the write.
