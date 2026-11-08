# Campaign approvals

Approvals are separate for configuration, an audience snapshot, a sequence version, a template version, and a recipient draft. A configuration approval does not approve a recipient draft. A recipient draft approval does not satisfy the Sprint 7 exact-draft send rule, and campaign code does not call that send path.

The requester cannot decide their own approval. The digest must match. An expired approval cannot be decided. One pending approval is allowed for a subject and version. Editing a campaign after approval is rejected while the lifecycle is frozen. Returning the campaign to `CONFIGURING` revokes the approved configuration. No approval inserts an outbox event of type `mailbox.send`.
