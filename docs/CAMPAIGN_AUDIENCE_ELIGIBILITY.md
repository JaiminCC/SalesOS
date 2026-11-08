# Campaign audience eligibility

Preparation uses the Sprint 5 eligibility and quiet-hour functions. The campaign decision is one of `ELIGIBLE_FOR_PREPARATION`, `REVIEW_REQUIRED`, `BLOCKED`, or `UNKNOWN`.

A candidate is not eligible for preparation when consent is unknown or withdrawn, the contact is unverified, the channel identity is missing, suppression is active, a human takeover is active, quiet hours block or are unknown, or the same verified identity is already enrolled in that campaign and channel. Unknown time zone stays `UNKNOWN`. The decision is not cached as permission to contact.

Preview returns totals for matches, eligible preparation, review, suppressed, human-owned, missing contact, missing permission, and duplicate candidates. If the organization has more than 500 active leads, preview and materialization return `AUDIENCE_LIMIT` and store no members. Lead identifiers are included only when the caller also has `crm.leads.read`. Email addresses and identity keys are not returned.

At each later step the worker reads suppression, takeover, withdrawn consent, lead stage, contact presence, campaign cancellation, and the campaign end date again. A stop from one of those facts ends the enrollment. It does not send.
