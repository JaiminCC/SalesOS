# Send-time policy engine

`evaluateSendGate` runs inside `sendDraft` immediately before a provider call. Facts come from the database in that transaction, not from the browser.

## Block reasons

The gate blocks when any of these is true: organization inactive, connection missing, sender missing `mailbox.send` plus `mailbox.send.execute` plus mailbox access `SEND`, approval missing or mismatched or expired, recipient not linked to a lead contact, suppression, human takeover, consent not `KNOWN`, contact not `VERIFIED`, eligibility not `ELIGIBLE`, quiet hours `BLOCK` or `UNKNOWN`, organization automation paused, agent paused, frequency or attempt limit, product restriction, header injection, attachment block, duplicate accepted or in-flight attempt, quota at the hourly cap, kill switch, or missing human action.

`UNKNOWN` quiet hours, unknown consent, and a failed eligibility fact are blocks. They are not treated as allow.

## After the checks

If the mailbox provider is `capture` or `manual`, the decision is `CAPTURE` and `sent` is false. No provider HTTP runs.

Otherwise the decision is `BLOCK` with `LIVE_SEND_NOT_CONFIGURED` unless the deployment flag, tenant policy, mailbox switch, and send scope are all on. If the provider is not `google`, `microsoft`, or the local `test` provider, the reason is `LIVE_SEND_NOT_IMPLEMENTED`.

`ALLOW` still returns `sent: false`. Only the later attempt row records provider acceptance, and that row also keeps `sent` false.

Suppression, takeover, quiet hours, or a lost permission that appears after approval is seen on this later read. The earlier approval does not freeze those facts.
