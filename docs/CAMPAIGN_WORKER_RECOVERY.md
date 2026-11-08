# Campaign worker recovery

Campaign jobs are outbox events. The relay publishes them to BullMQ. `processCampaignWorkerJob` loads the payload, checks the tenant and `campaigns.simulate`, then runs `processCampaignJob`.

Pause points used by the kill test write `checkpoint` and then wait. `SIGKILL` during `during-advance` or `during-draft` rolls back the open transaction, so no draft is left. A replacement call creates one draft. `after-draft` runs only after that transaction commits. A repeated personalize call returns the existing draft.

A cancelled campaign does not add drafts. A suspended tenant returns `TENANT_SUSPENDED`. Removing `campaigns.simulate` returns `AUTH_REVOKED`. Neither path writes `mailbox_send_attempts`.

Audience materialize also has `during-audience` and `after-segment` pause points. The kill spec drives the draft and enrollment points. The audience points are available for the same child-process harness.
