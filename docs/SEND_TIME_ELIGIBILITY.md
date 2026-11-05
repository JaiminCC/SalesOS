# Send-time eligibility

`sendDraft` loads the current draft version, the matching approval, the mailbox, and CRM facts, then calls `evaluateSendGate`. The check runs at that moment, not only when the draft was written.

The gate blocks when the organization is inactive, the mailbox is unavailable, the sender is not allowed, the approval digest does not match, the approval is expired, the recipient is unknown, the contact is suppressed, a human takeover is active, consent is unknown, the recipient is unverified, eligibility is not an allow, quiet hours are not `ALLOW`, the organization or agent is paused, a frequency or product or content or attachment rule fails, a prior attempt was accepted, a rate limit applies, or there is no human send action.

A missing linked lead leaves the recipient unknown and consent unknown, so the send blocks. `UNKNOWN` does not become allow.

A capture mailbox that passes every check returns `CAPTURE` and `sent: false`. Any other mailbox, including one with live flags and a send scope, returns `BLOCK` and `LIVE_SEND_NOT_IMPLEMENTED`. Approval does not bypass the gate.

The attempt row stores the state, the reason, `sent: false`, and a provider message id only for capture (`capture-...`). That id is not proof of delivery.
