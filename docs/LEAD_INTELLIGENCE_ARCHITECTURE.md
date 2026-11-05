# Lead intelligence architecture

SalesOS answers which companies fit a published product, why, which contact is known, what evidence supports the fit, and whether contact is authorized. Those are separate decisions.

1. A discovery job stores candidates and source evidence. Promoting a candidate creates a company. It does not create a lead and it does not authorize outreach.
2. A person creates a lead for one account and, when relevant, one product. The same company may have another lead for a different product.
3. Qualification reads the published product version and ICP, scores the stored company and contact fields, and appends a `crm_qualifications` row. Requalification appends another row. It does not erase history.
4. Eligibility reads suppression, human takeover, consent, and contact verification. Unknown consent stays unknown. A failed lookup is `REVIEW_REQUIRED`, not eligible.
5. Quiet hours are evaluated separately. An `ALLOW` result still does not send a message in this sprint.
6. When an agent run has `lead_id`, the proposal gate loads suppression, takeover, eligibility, and quiet hours. A run without a lead keeps `audienceKnown: false`. The proposal outcome remains unsent.

The signed-in screen is `apps/web/components/management/LeadsDesk.jsx`. The API is `apps/api/src/crm`. Shared rules are `packages/shared/src/crm.ts`. Durable import, discovery, and qualification jobs are `crm.import`, `crm.discovery`, and `crm.qualify` on the existing BullMQ queue. The API also runs the job before returning so the screen does not wait for a second process. The worker claims a `QUEUED` batch and skips a batch that is already `COMPLETED`.

Lead tools `lead.account.read`, `lead.contact.read`, `lead.research.evidence.read`, `lead.research.summarize`, `lead.research.find_gaps`, `lead.icp.evaluate`, `lead.qualification.explain`, `lead.qualification.propose`, and `lead.eligibility.read` are registered with permission `agents.manage`. They are not part of the default product supervisor plan. A local lead tool result is `{ status: 'UNKNOWN', advisory: true }` so a plan cannot treat generated text as a sourced fact. The supported qualification path is `qualification/run`.
