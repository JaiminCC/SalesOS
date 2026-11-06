# Mailbox sync operations

The worker jobs remain `mailbox.sync`, `mailbox.incremental_sync`, and `mailbox.reconcile`. Sprint 8 records each provider read.

Limits:

- One provider page is at most 10 messages.
- Historical backfill stays on the existing cursor `backfillRemaining` default of 2.
- Scheduled reads use `list_due_mailbox_connections` and skip paused, disconnected, and sending-enabled rows.
- A manual sync uses the same fence as a scheduled sync.

Rules:

- Provider HTTP is outside the database transaction.
- Messages and the cursor commit together.
- The worker rechecks tenant status, membership, `mailbox.connect`, revocation version, read access, and the lease token before that commit.
- A stale lease cannot advance the cursor.
- Repeated provider message ids are skipped by the unique key `(tenant_id, connection_id, provider_message_id)`.
- HTTP 429 does not mark the mailbox synced and does not move the cursor.
- Send scopes `gmail.send` and `Mail.Send` on a read connection stop the sync and do not enable sending.
- Cursor recovery does not delete stored messages and does not send mail.
