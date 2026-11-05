# Lead AI execution

Lead explanation uses the Sprint 4 supervisor. There is no second model runner.

`planKind` on run creation is `PRODUCT_RESEARCH` or `LEAD_RESEARCH_AND_QUALIFY`. The product plan is still `buildSupervisorPlan`. The lead plan is `buildLeadResearchPlan`. The goal text does not select the plan.

`LEAD_RESEARCH_AND_QUALIFY` requires a lead in the same tenant, a published product, and `crm.leads.qualify`. The stored plan is:

1. `lead.account.read`
2. `lead.contact.read`
3. `lead.research.evidence.read`
4. `lead.research.find_gaps`
5. `lead.icp.evaluate`
6. `lead.research.summarize`
7. `lead.qualification.explain`
8. `lead.qualification.propose`
9. `lead.eligibility.read`

The product plan's tool ceiling stays 8. A lead run stores `maxToolCalls: 12` on that run only. Model calls still use the supervisor lease. The database transaction is not held open during the model HTTP call.

`lead.icp.evaluate` and `lead.qualification.propose` both call the deterministic scorer. Propose writes `crm_qualifications` and the lead's score, grade, and stage. A repeated propose for the same run id does not insert a second row. The model output is accepted only when it copies the official score, grade, and dimension fits and names those dimensions in the strengths and research questions. Anything else is stored as the deterministic breakdown with `INSUFFICIENT_EXPLANATION`, and the qualification row's model fields stay empty. The model's number is never written as the score. See `docs/LEAD_QUALIFICATION_EXPLANATIONS.md`.

The two model tools receive stored company attributes, the official score when it already exists, explicit `UNKNOWN` gaps, and pinned citation ids. The prompt tells the model that company text is untrusted and that the score is fixed. Contact email and phone are not placed in the prompt. Employee and revenue figures are included only when their status is `VERIFIED`.

`qualification/run` without a model configuration still calls `storeQualification` directly and records `explanationSource: deterministic`. With a model configuration it starts the lead plan and returns the score from the lead row after the run reaches `SUCCEEDED`. A failed run does not substitute another provider.

The Sprint 5.1 local run stored "The official lead qualification score is 65, corresponding to a grade of B." Sprint 5.2 treats that sentence as `INSUFFICIENT_EXPLANATION`. The 5 November 2026 acceptance called the saved Ollama model (`gemma4:e4b`). Its payload was not accepted after one repair. The stored explanation is the deterministic breakdown, the qualification model fields are empty, and usage remains on the Ollama run. The Logistics / US / 51-200 fixture stays at 65 / grade B. Buyer, trigger, and technology stay `UNKNOWN`. The command and exit code are in `docs/SPRINT_5_2_COMPLETION.md`.

Standard `pnpm test` uses the fake provider for the same plan. The real-model file is `apps/api/src/crm/lead-model.acceptance.ts`. It is outside the default Vitest include. Run it with:

```bash
pnpm --filter @salesos/api exec vitest run --config vitest.acceptance.config.ts
```
