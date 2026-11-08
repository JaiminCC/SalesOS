# Campaign data model

All 23 campaign tables are tenant-scoped, use `@@id([tenantId, id])`, and have forced row-level security. The catalog is `docs/DATABASE_DESIGN.md` section 17.

`campaigns` stores the lifecycle, the pinned `product_version_id`, `icp_ref`, the current segment version, and the current sequence version. `campaign_products` records each product version the campaign has used. `campaign_audiences` points a campaign at a segment version. `audience_members` is the materialized set for that version. `campaign_exclusions` records who was left out and why.

`campaign_enrollments` is unique on tenant, campaign, channel, and `identity_key`. The key is the contact email HMAC only when verification is `VERIFIED`. A missing identity is not enrolled. `campaign_step_executions` is unique on tenant and idempotency key, which is the enrollment id plus the step id.

`campaign_drafts` and `campaign_draft_versions` store the prepared text, the facts used, citations, and the model name only when the text passed validation. `campaign_approvals` binds a kind, a subject, a version reference, and a digest. `campaign_schedules` stores the next internal wait. `campaign_runs` stores the simulation trace id. `campaign_analytics_snapshots` stores aggregate preparation counts, not delivery counts.
