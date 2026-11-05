# Sprint 4 readiness

**Date:** 5 November 2026  
**Updated by:** Sprint 4 close  
**Verdict:** CONDITIONAL PASS — local Ollama inference passed. Suppression, ownership, and quiet hours are still not loaded from lead data.  
**Sprint 5:** Not started.

An authenticated owner can store an explicit mock or HTTP model, pin a published product version, start a bounded run, inspect steps and citations, and approve a draft without sending it. `processAgentRunJob` and `AgentsService` call `createModelClient` from the selected row. They do not construct `FakeLlmProvider` unless that row says `fake`.

## Outcome rule

| Outcome | Applies |
| --- | --- |
| PASS — ready for Sprint 5 | No. A local Ollama run passed, and suppression, human ownership, and quiet hours are still not loaded from lead data. |
| CONDITIONAL PASS — fix listed gaps, then expand | Yes. The Sprint 4 High blockers that were missing execution, tools, provenance, and approvals are addressed in code and tests. Sprint 5 should wait until a hosted provider smoke is authorized and the remaining medium policy inputs exist. |
| FAIL — core AI runtime incomplete | No longer. The 5 November audit recorded FAIL against the fake-only executor. That executor is not on the production path. |

## Sprint 4.1 definition of done

| Item | Status |
| --- | --- |
| Production runs do not silently use `FakeLlmProvider` | PASS |
| Configurable provider adapter is wired | PASS |
| A real model was called | PASS for local Ollama `gemma4:e4b`. See `docs/REAL_MODEL_SMOKE_TEST.md`. A hosted cloud credential was not used. |
| Published product context is pinned on research and strategy runs | PASS |
| Product and version provenance is stored | PASS |
| Supervisor executes a bounded plan | PASS |
| Internal tools are registered and invoked | PASS |
| Policy is applied before an external proposal | PASS |
| Approval inbox and decisions persist | PASS |
| External send stays disabled | PASS |
| Pause, resume, and cancel bump the lease | PASS for cancel-during-callback. Browser pause and resume are in `agents.spec.ts`. |
| Worker crash recovery kills a process | PASS |
| Quotas are enforced | PASS |
| Usage and cost use a price rate | PASS |
| Tenant isolation regression | PASS |
| Management UI uses the existing kit | PASS |
| Browser test shows stored execution | Covered by `pnpm test:e2e` |
| Sprint 1–3.1 tests | Covered by `pnpm test` |
| Documentation | PASS |
| No open Critical or High blocker from the audit | PASS, with the medium gaps below |

## Remaining limits

- Local Ollama inference passed on `gemma4:e4b`. The endpoint and model name stay in the saved configuration row. They are not production defaults. No hosted cloud credential was used.
- `audienceKnown` is false on every persisted proposal. An external action with an unknown audience cannot return ALLOW. `suppressed` and `humanOwned` are still not loaded from lead or conversation records. Those tables are out of scope.
- Autonomy levels A1–A3 still require approval for every external proposal.
- Quiet hours are not implemented.
- Model calls are at-least-once across worker recovery.
- `executeAgentRun` remains for the older worker regression tests. The API and the worker job do not call it.
- Approved external proposals stay `APPROVED_NOT_EXECUTABLE`. Nothing in this sprint delivers them.
