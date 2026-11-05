# Exact draft approvals

`draftDigest` hashes a canonical JSON object: lower-cased sender, sorted recipients, cc, and bcc, subject, body, HTML (empty when omitted), sorted attachment digests, purpose, and thread reference. The server computes the digest when a draft version is saved. The approval stores that version's `bodySha256`. The client cannot submit a digest and have it trusted.

`sendDraft` allows the approval only when `payloadSha256` equals the current version hash and `expiresAt` is in the future. A different subject, body, recipient, cc, bcc, sender, attachment list, thread reference, purpose, or version produces a different digest. Saving a new version returns the draft to `DRAFT` and the previous approval no longer matches.

Approval states used by the current engine are the Sprint 6 decisions, including `PENDING_REVIEW` and `APPROVED`. A Sprint 4 agent approval of `APPROVED_NOT_EXECUTABLE` is a different table and is not read by `sendDraft`.

An approval is not a send. `email-approvals/decide` does not enqueue `MAILBOX_SEND_JOB`. A second decision on the same row returns `ALREADY_DECIDED`.

Attachment bytes are not part of outbound send. Attachment sending is `NOT SUPPORTED`, so a reviewed message cannot silently gain a file.
