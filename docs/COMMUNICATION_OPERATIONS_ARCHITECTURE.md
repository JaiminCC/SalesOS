# Communication operations architecture

The signed-in Inbox desk has three operational sections: Operations, Sync jobs, and Alerts. They stay on the existing Inbox navigation. No new sidebar id was added. Record ids stay in JSON bodies and session navigation tokens. Browser paths do not contain database ids.

Overview counts only mailboxes the current member can access. Capture rows are counted separately and are not included in the healthy-connection count. Aggregates for syncs, duplicates, throttling, and uncertain deliveries come from stored rows for those mailboxes. There is no synthetic live metric.

Read-only sync remains `syncConnection` in `packages/database/src/mailbox-work.ts`. Provider HTTP stays outside the database transaction. Message inserts and cursor advancement stay in one transaction, after the lease and `revocation_version` are checked again. A page that still has a provider next link is stored as `SYNC_PARTIAL` with health `SYNC_DELAYED`. A terminal page is `SYNCED` with health `HEALTHY` only for Google or Microsoft. Capture health stays `CAPTURE`.

Pause sets `sync_paused`. `list_due_mailbox_connections` skips paused rows. Resume does not send. Cursor recovery is allowed only when health is `CURSOR_EXPIRED` or the last error is `CURSOR_RECOVERED`. It rewrites the cursor to list or delta mode, writes a recovery run, and does not call the provider.

Metrics are one JSON log line with `metric`, `provider`, and `code`. Labels do not include mailbox addresses, user ids, tokens, subjects, cursors, or contact data.
