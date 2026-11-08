# Campaign architecture

A signed-in campaign is a tenant-owned preparation record. It names a goal, a channel, a time zone, an owner, a published product version, and an ICP reference that must exist on that version. The product version id is stored on the campaign. Publishing a newer product version does not change it.

The state machine lives in `packages/shared/src/campaigns.ts`. Each transition checks the current state, the caller's permission, and the tenant. Configuration approval requires a different member from the requester. Moving back to `CONFIGURING` revokes the prior configuration approval. An approved campaign still has `sending_status = NOT_AUTHORIZED`.

The engine is `packages/database/src/campaign-work.ts`. The API is `apps/api/src/campaigns`. The signed-in screen is `apps/web/components/management/CampaignsDesk.jsx`. Worker jobs use the existing outbox and BullMQ names in `packages/shared/src/jobs.ts`. Model work uses the Sprint 4 supervisor and the additional plan `CAMPAIGN_PREPARE_AND_PERSONALIZE`.

Nothing in the campaign path imports `sendDraft`, `sendWithGmail`, or `sendWithGraph`. Simulation outcomes are `PLANNED`, `ELIGIBLE_FOR_PREPARATION`, `BLOCKED`, `WAITING`, `REQUIRES_REVIEW`, `DRAFT_PREPARED`, `SIMULATED_STEP`, and `SIMULATION_COMPLETE`.
