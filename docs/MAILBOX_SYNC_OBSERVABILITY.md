# Mailbox sync observability

Each provider sync writes one `mailbox_sync_runs` row with the tenant, mailbox, provider, job type, trigger, start and finish, worker pid, lease version, page count, inserted count, duplicate count, cursor fingerprints, rate-limit flag, error code, final state, and trace id. The raw cursor stays on `mailbox_sync_cursors`.

List views return the fingerprint. They do not return the opaque provider token.

Log lines use only these names and a provider plus a result code:

`mailbox_sync_started`, `mailbox_sync_completed`, `mailbox_sync_failed`, `mailbox_provider_rate_limited`, `mailbox_cursor_recovered`.

No mailbox address, user id, token, subject, cursor, or contact value is placed in the log labels. No new metrics service was added.
