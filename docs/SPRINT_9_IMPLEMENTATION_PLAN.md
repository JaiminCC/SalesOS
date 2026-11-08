# Sprint 9 implementation plan

Signed-in campaign management is PostgreSQL-backed preparation. It does not send email or WhatsApp and does not call the Sprint 7 provider adapters. The signed-out campaigns page stays simulated.

| Feature | UI | API | Database | Worker | Permission | Tests |
|---|---|---|---|---|---|---|
| Campaign records | Campaigns list, add, view, edit | `campaigns/list`, `get`, `create`, `update`, `clone`, `archive` | `campaigns`, `campaign_products` | none | `campaigns.read`, `create`, `edit`, `archive` | `campaign-work.spec.ts`, `campaign.integration.spec.ts`, `e2e/campaign.spec.ts` |
| Lifecycle | View actions | `campaigns/transition` | `campaigns.state`, `campaign_activity` | none | `campaigns.edit` | `campaigns.spec.ts`, `campaign-work.spec.ts` |
| Segments | Segments section | `segments/*` | `audience_segments`, `audience_segment_versions`, `audience_members` | `campaign.segment.materialize`, `campaign.audience.evaluate` | `campaigns.audience.manage` | `campaigns.spec.ts`, `campaign-work.spec.ts` |
| Eligibility | Preview counts | `segments/preview` | `campaign_exclusions`, `campaign_policy_evaluations` | rechecked on advance | `campaigns.read` | `campaigns.spec.ts`, `campaign-work.spec.ts` |
| Sequences | Sequences section | `sequences/*` | `campaign_sequences`, versions, steps, conditions | `campaign.sequence.prepare` | `campaigns.sequence.manage` | `campaigns.spec.ts` |
| Templates | Templates section | `campaign-templates/*` | `campaign_templates`, `campaign_template_versions` | none | `campaigns.template.manage` | `campaigns.spec.ts` |
| Personalization | Supervisor run, personalize API | `runs/create` plan `CAMPAIGN_PREPARE_AND_PERSONALIZE`, `campaign-simulation/personalize` | `campaign_drafts`, `campaign_draft_versions`, `llm_usage` | `campaign.draft.personalize` | `campaigns.simulate` | `campaign-model.acceptance.ts` |
| Approvals | Submit for review | `campaign-approvals/request`, `decide` | `campaign_approvals` | `campaign.approval.request` | `campaigns.edit`, `campaigns.review` | `campaign-work.spec.ts` |
| Simulation | Start, pause, resume, cancel, monitor | `campaign-simulation/start`, `advance`, `monitor` | `campaign_runs`, `campaign_enrollments`, `campaign_step_executions` | `campaign.simulation.run`, `campaign.enrollment.advance` | `campaigns.simulate` | `campaign-work.spec.ts`, `campaign-kill.spec.ts` |
| Scheduling | Scheduled simulation state | transition to `SCHEDULED` | `campaign_schedules` | `list_due_campaign_schedules` | `campaigns.simulate` | `campaign-work.spec.ts` |
| Analytics | Analytics section | `campaign-analytics/summary` | `campaign_analytics_snapshots` | `campaign.analytics.aggregate` | `campaigns.analytics.read` | `campaign-work.spec.ts` |
| No send | Banner and `NOT AVAILABLE` metrics | no send route | `sending_status`, `live_delivery` checks | no send job | none grants send | `campaign-nosend.spec.ts` |

Navigation resource types are `campaign`, `audience_segment`, `campaign_sequence`, `campaign_template`, and `campaign_run`. Browser URLs stay `/workspace/campaigns`, `/add`, `/view`, and `/edit`.
