# Email send authorization

## Permissions

| Permission | Who receives it in the system catalog | What it allows |
|---|---|---|
| `mailbox.read` | Owner, admin, manager, sales, viewer | Read mailbox records. Not send. |
| `mailbox.connect` | Owner, admin | Connect or disconnect. Not send. |
| `mailbox.draft` | Owner, admin, manager, sales | Write a draft. Not send. |
| `mailbox.review` | Owner, admin, manager, reviewer | Decide an approval. The author is rejected. |
| `mailbox.send` | Owner, admin | Existing Sprint 6 send permission. Still required. |
| `mailbox.send.request` | Owner, admin, sales | Start the send-scope OAuth URL. |
| `mailbox.send.review` | Owner, admin, manager, reviewer | Review permission distinct from execution. |
| `mailbox.send.execute` | Owner, admin | Required, with `mailbox.send` and mailbox access `SEND`, before the gate allows dispatch. |
| `mailbox.send.manage` | Owner, admin | Change the tenant policy or the mailbox sending switch. |

Viewer does not receive send, execute, or manage. A reviewer who only has `mailbox.send` and `mailbox.review` still cannot execute, because `mailbox.send.execute` is separate.

`mailbox.connect` does not set `sending_enabled`.

## Capability

`READ_ONLY` is the default. `SEND_REQUESTED` is set when send-scope OAuth is started for an existing connection. `SEND_AUTHORIZED` is set only when the token exchange reports a send scope. `sending_enabled` is a further switch and defaults false. Disconnect clears tokens and sets `sending_enabled` false.

## Author and reviewer

`reviewDraft` returns `SEPARATION_OF_DUTIES` when `draft.createdBy` is the acting user. Approval does not call `sendDraft`.

## Deployment

`liveEmailSendEnabled` is false in test and CI. Otherwise it is true only when `SALESOS_LIVE_EMAIL_SEND_ENABLED` is the string `true`. The UI status sets `sendNow` to false. The Inbox screen does not render a `SEND NOW` button.
