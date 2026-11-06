# Sprint 8 implementation plan

Communication Operations extends the Sprint 6 sync engine and the Sprint 7 delivery records. It does not add a second sync service and it does not enable sending.

| Requirement | UI | API | Database | Worker | RBAC | Test |
|---|---|---|---|---|---|---|
| Provider readiness | Inbox providers line and Operations overview | `mailboxes/providers`, `operations/overview` | none; env only | none | `mailbox.read`, `mailbox.operations.read` | shared mailbox spec, API mailbox integration |
| Connection health | Operations list and detail | `operations/connections`, `operations/get` | `mailbox_connections.health_state`, `mailbox_health_events` | recorded at the end of `syncConnection` | `mailbox.operations.read` | worker recovery stores a stub verification |
| Sync history | Sync jobs | `operations/runs` | `mailbox_sync_runs` | same sync path | `mailbox.operations.read` | worker recovery |
| Provider errors | connection detail | `operations/errors` | `mailbox_provider_errors` | classified by `classifyMailboxError` | `mailbox.operations.read` | shared classifier spec |
| Alerts | Alerts | `operations/alerts`, `operations/alerts/acknowledge` | `mailbox_operational_alerts` | opened from a classified failure | `mailbox.health.read`, `mailbox.operations.manage` | API permission check |
| Manual read sync | Sync now confirmation | existing `mailbox-sync/run` | existing cursor and messages | `syncConnection` | `mailbox.connect` | existing recovery spec |
| Pause and resume | Pause / Resume confirmation | `operations/pause` | `sync_paused`; due function skips paused rows | scheduled reads skip paused rows | `mailbox.operations.manage` | migration function |
| Cursor recovery | Recover cursor confirmation | `operations/recover-cursor` | cursor reset plus a recovery run | no provider call | `mailbox.sync.recover` | precondition `CURSOR_EXPIRED` |
| Verification evidence | overview live-read count | server writes the row | `mailbox_provider_verifications` | `verificationOrigin` | not caller-supplied | worker asserts origin `STUB` |
| Delivery investigation | existing Delivery and Sending sections | existing delivery endpoints | Sprint 7 tables | reconciliation still does not send | existing send review | existing send tests |
| Capture vs live | `MOCK / CAPTURE MODE`, capture health `CAPTURE` | capture create sets `health_state = CAPTURE` | connection row | capture sync is unchanged | mailbox access | API capture label |

Acceptance evidence for a real mailbox is absent. The overview therefore reports `LIVE GMAIL — NOT CONFIGURED`, `LIVE MICROSOFT — NOT CONFIGURED`, and `REAL READ-ONLY SYNC — NOT TESTED`.
