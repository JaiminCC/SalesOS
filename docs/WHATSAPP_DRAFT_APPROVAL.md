# WhatsApp draft approval

An approval binds the tenant, draft version digest, conversation, recipient, reviewer, consent status, and window state. The author cannot review the draft. A changed digest is `STALE_APPROVAL`. Opt-out is `SUPPRESSED`.

The stored decision is `APPROVED` or `REJECTED`. `dispatched` is false. The approval does not call a provider API and does not create a send attempt. A later sprint would have to add a separate authorization before any delivery.
