# Sprint 6 implementation plan

Sprint 6 adds a tenant-scoped mailbox, capture import, draft review, and a send gate that does not deliver mail. Live Google and Microsoft mailboxes stay unconfigured until OAuth client credentials exist. Live sending stays off.

| Feature | API | Database | Worker | UI | Permission | Test |
|---|---|---|---|---|---|---|
| Provider catalog | `POST /api/v1/management/mailboxes/providers` | none | none | Inbox provider line | `mailbox.read` | API integration |
| Capture mailbox | `mailboxes/capture`, `mailboxes/list`, `mailboxes/get`, `mailboxes/disconnect` | `mailbox_connections`, `mailbox_access` | none | Add mailbox, list, disconnect | `mailbox.connect` / `mailbox.read` | API integration, browser |
| OAuth start | `mailboxes/oauth/start` | `mailbox_oauth_states` | none | Not a connected mailbox | `mailbox.connect` | API integration, redirect rejection |
| OAuth callback | `GET /api/v1/mailbox/oauth/callback` | state row, connection only after token exchange | none | Redirect query `mailbox=` | state hash, not session CSRF | Unit exchange with a stub; live callback not tested |
| Import and sync | `mailbox-sync/import`, `mailbox-sync/run` | cursors, threads, messages, sync events, `crm_work_leases` | `mailbox.sync` | Import form | `mailbox.connect` plus mailbox access | API integration, process-kill recovery |
| Threads | `threads/list`, `threads/get`, `threads/link`, `threads/assign` | `mailbox_threads`, `mailbox_messages`, `mailbox_thread_links` | none | Inbox list and detail | `mailbox.read` / `mailbox.draft` | API integration |
| Drafts | `drafts/save`, `drafts/submit`, `drafts/list` | `mailbox_drafts`, `mailbox_draft_versions` | none | Add draft | `mailbox.draft` | API integration |
| Approval | `email-approvals/decide` | `mailbox_approvals` | none | Approval action | `mailbox.review`, not the author | API integration |
| Send review | `email-send/run` | `mailbox_send_attempts`, `mailbox_delivery_events` | `mailbox.send` calls the same gate | Send review | `mailbox.send` | API integration, `sent: false` |
| Reconcile | `delivery/reconcile`, `delivery/list` | delivery events | no separate reconcile worker | Delivery list | `mailbox.read` | gate and capture rows |
| Inbox analysis | `inbox-ai/run` | `agent_runs`, `mailbox_ai_analyses` | existing agent worker | not a separate screen | `mailbox.draft` | tool registry; no live model run |
| Webhooks | `POST /api/v1/mailbox/webhooks/:provider` | `mailbox_webhook_receipts` | none | none | HMAC for capture; other providers `NOT_CONFIGURED` | API integration |

Navigation types are `mailbox_connection`, `mailbox_thread`, and `mailbox_draft`. Paths are `/workspace/inbox`, `/workspace/inbox/add`, and `/workspace/inbox/view`.
