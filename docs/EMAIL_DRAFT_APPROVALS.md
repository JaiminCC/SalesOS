# Email draft approvals

`drafts/save` writes `mailbox_drafts` and a `mailbox_draft_versions` row. The version stores `body_sha256` from `draftDigest` over the sender, sorted recipients, subject, body, and attachment digests.

`drafts/submit` creates a `PENDING_REVIEW` approval bound to that version digest, with a 24-hour expiry. Saving the draft again increments the version and revokes prior `APPROVED` rows for that draft.

`email-approvals/decide` requires `mailbox.review`, mailbox access, and a different user from `created_by`. The author receives `403 SEPARATION_OF_DUTIES`. A second decision on the same row returns `409 ALREADY_DECIDED`. Approval does not send.

The integration test covers author denial, a second member approving, an edit returning the draft to `DRAFT`, and a later send that stays `sent: false`.
