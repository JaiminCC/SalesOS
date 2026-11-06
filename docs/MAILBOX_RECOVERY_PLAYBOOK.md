# Mailbox recovery playbook

| Action | When | What it does | What it refuses |
|---|---|---|---|
| Sync now | The member has `mailbox.connect` and the mailbox is connected | Runs the existing read-only sync | Sending, and a sync while the lease is held |
| Pause | `mailbox.operations.manage` | Sets `sync_paused` and health `DEGRADED` | Sending |
| Resume | `mailbox.operations.manage` | Clears `sync_paused` | Sending |
| Reauthorize | `mailbox.connect` | Starts the existing read-only OAuth URL when a client id exists | Send scopes, and a simulated login when the client is absent |
| Recover cursor | Health is `CURSOR_EXPIRED` or the last error is `CURSOR_RECOVERED`, and the member has `mailbox.sync.recover` | Resets the cursor to list or delta mode and writes a recovery run | Capture mailboxes, disconnected mailboxes, healthy mailboxes, provider calls, and sending |
| Acknowledge alert | `mailbox.operations.manage` | Marks the alert acknowledged | Delivery changes and quota release |
| Reconcile delivery | Existing Sprint 7 control | Reads provider evidence when live send is on | A send endpoint, and any automatic retry of `DELIVERY_UNKNOWN` |

Disconnect still increments `revocation_version` and clears tokens. A worker that already downloaded a page cannot commit it after that change.
