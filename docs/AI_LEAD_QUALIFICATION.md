# AI lead qualification

The official score is deterministic. `storeQualification` loads the lead's pinned product version, selects the named ICP or the first ICP in the snapshot, and compares industry, company size, and country with `compareTextList`. A buyer is a match only when the contact decision class is `DECISION_MAKER`. Need is a match only when the company description is present. Trigger and technology stay `UNKNOWN` unless a later scorer is given evidence. Empty ICP lists do not count as a match.

The scoring version stored on each row is `crm-score-1`. Weights are the defaults in `DEFAULT_SCORE_WEIGHTS`. The row stores dimensions, weights, confidence, product version, ICP name, and explanation. A human override writes `scoring_version` `human-override-1`, `overridden` true, and the reason. The previous rows remain.

The verified fixture is a Logistics company in the US with size `51-200` and a description, against an ICP with those three lists. The score is 65 and the grade is B: industry 20, size 15, geography 15, and need 15. Buyer, trigger, and technology stay unknown. The API test asserts that score and asserts a second run returns the same score.

`qualification/run` without `modelConfigurationId` stores the deterministic score only. With `modelConfigurationId`, the API starts a `LEAD_RESEARCH_AND_QUALIFY` supervisor run. That run calls the nine `lead.*` tools. `lead.icp.evaluate` and `lead.qualification.propose` recompute `scoreIcp`. The explain tool may add a structured explanation. If that explanation does not match the scorer, the stored text is the deterministic breakdown and is marked `INSUFFICIENT_EXPLANATION`. See `docs/LEAD_QUALIFICATION_EXPLANATIONS.md`.

Stage changes follow the lead graph. A new lead moves through `RESEARCHING` and `RESEARCHED` before `QUALIFIED`, `UNQUALIFIED`, or `REVIEW_REQUIRED`. Each hop is written to `crm_stage_history`.
