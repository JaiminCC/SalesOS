# Sprint 4 security and reliability findings

**Date:** 5 November 2026  
**Critical:** none reproduced.  
**High open:** 6. **High fixed:** 1.  
**Rule:** A finding cites the code that was read. Recommended corrections are not implemented unless the status is FIXED.

## Critical

No cross-tenant run read, credential disclosure, or irreversible external send was reproduced.

The live proposal is internal, and both the API and the worker throw status 503 if `sendExternal` is reached. A paused organization skips that call for a pre-seeded `READY` action. Another organization's `runs/get` returns 404 in `apps/api/src/agents/agents.integration.spec.ts`.

## High

### S4-H1 — Configured model is never invoked

- **Severity:** High
- **Location:** `apps/api/src/agents/agents.service.ts` `propose`; `apps/worker/src/agent-job.ts` `processAgentRunJob`; unused `packages/agent-core/src/http-llm.ts` `HttpStructuredLlm`.
- **Reproduction:** Sign in, enqueue a scan, and read the run. `modelProvider` is `fake` and `modelName` is `fake-1`. Set `tenants.llm_provider` to any other value. The generator still constructs `FakeLlmProvider`. The environment has no hosted or self-hosted model key.
- **Impact:** Users can believe a supervisor evaluated their organization. The stored decision is a fixed `CREATE_TASK` or `NO_ACTION`. A later wiring of `HttpStructuredLlm` as written would also send no credential and would not block private network addresses.
- **Correction:** Select the provider outside the database transaction from tenant settings. Keep `fake` as the explicit test provider. Store credentials encrypted, omit them from responses, and refuse a provider URL that resolves to a local or private address. Do not mark a run successful when the selected provider was not called.
- **Test:** None calls `HttpStructuredLlm`. `repair.spec.ts` uses the fake script only.
- **Status:** OPEN

### S4-H2 — Agent approval controls are absent

- **Severity:** High
- **Location:** `packages/database/src/agent-run.ts` sets `NEEDS_APPROVAL` and `WAITING_APPROVAL`. `apps/api/src/agents/agents.controller.ts` has no decision route. `apps/web/components/SalesOS.jsx` approval page updates `store.approvals`.
- **Reproduction:** There is no request that approves an `agent_actions` row. The Approval Center buttons change local prototype objects.
- **Impact:** An external proposal can sit in `NEEDS_APPROVAL` with no owner, no expiry, and no binding decision. Product and knowledge approval do not cover this action. An approval cannot send mail because the decision cannot be recorded.
- **Correction:** Add an approval record bound to the tenant, run, action, and exact payload hash. Recheck `automation.pause` or the approval permission at decision time. Enforce one decision. Expiry and membership removal must cancel the pending action. Approval must not call a mailbox in this phase.
- **Test:** None.
- **Status:** OPEN

### S4-H3 — Runs do not use approved product knowledge

- **Severity:** High
- **Location:** `AgentsService.createRun` writes `productVersionId` from the body. `executeAgentRun` never calls `ProductsService.preview`. `agent_runs.product_version_id` has no foreign key in `20261105120000_agent_runtime`.
- **Reproduction:** `POST /api/v1/management/runs/create` with a random `productVersionId` stores it. The run steps do not contain a version id, document ids, or citations. Approved knowledge is not in the model input. The model input is the trigger word.
- **Impact:** A run cannot be audited back to a published snapshot. A caller can attach an unpublished or foreign UUID. Later publication cannot be shown to have changed the run, because no snapshot was frozen.
- **Correction:** Resolve a published version inside the tenant before insert. Persist `provenance` from the existing preview service. Reject drafts unless the caller has draft permission and the run is explicitly not live. Do not put chunk text in logs.
- **Test:** Product preview tests do not start an agent run.
- **Status:** OPEN

### S4-H4 — No authorized tool boundary

- **Severity:** High
- **Location:** `packages/agent-core/src/llm.ts` `acceptProposal`; `executeAgentRun` marks a non-external `ALLOW` action `SUCCEEDED` without a tool call.
- **Reproduction:** A scan run’s action type is `CREATE_TASK` and its outcome is `{ sent: false }`. No research, ICP, strategy, or knowledge function runs. There is no registry with name, version, schemas, permission, risk, timeout, or idempotency policy.
- **Impact:** The inspector shows an executed step for work that did not happen. Policy cannot independently refuse a tool the model named, because tools are not executed. Model text also cannot reach SQL or the shell today, only because no executor interprets it.
- **Correction:** One named executor per tool. The model may propose a name. The executor checks permission, tenant, schema, and approval, then writes the tool result. Unknown names become `FAILED_FINAL`.
- **Test:** None.
- **Status:** OPEN

### S4-H5 — Resume skips policy, and per-agent pause does not stop work

- **Severity:** High
- **Location:** `executeAgentRun` returns early for a terminal action and calls `finishExternal` for `READY` or `PAUSED`. `AgentsService.pauseAgent` updates only `agent_profiles`.
- **Reproduction:** Pause a run that already has a `PAUSED` or `READY` action, then resume. The code sends, or records a provider failure, without calling `decide()`. Pause one agent. Queued runs for that agent are not cancelled and no BullMQ job is removed. `resumeRun` itself has no test.
- **Impact:** A policy change, a new kill switch, or a disabled agent does not get a second decision before an external action that was already `READY`. Architecture §5.3 requires resume to run policy again.
- **Correction:** On resume, load the stored proposal and call `decide()` with current suppression, ownership, and kill-switch state. If the result is not `ALLOW`, do not call `sendExternal`. Per-agent pause should mark that agent’s queued actions `PAUSED`.
- **Test:** Worker spec covers organization pause before the first send. It does not resume.
- **Status:** OPEN

### S4-H6 — Execution and cost limits are not enforced

- **Severity:** High
- **Location:** `executeAgentRun` calls `deps.generate()` once inside the tenant transaction. `cost_minor` is `inputTokens + outputTokens`. Default `llm_monthly_budget_minor` is `1000000`.
- **Reproduction:** No code reads a maximum step count, tool count, duration, or context window. The fake provider’s cost is about 2 per run, so the default budget does not stop a practical test. `budgetStop` is unit-tested as arithmetic only.
- **Impact:** The current function happens to ask once. Nothing rejects a later loop, a long prompt, or a provider that reports a large token count as a real currency charge. The database transaction stays open for the whole generate call.
- **Correction:** Move the model call outside the transaction. Enforce explicit maxima and a rate table before creating `llm_usage`. Add a test that a spent total at the limit does not call the generator.
- **Test:** `policy.spec.ts` `budgetStop(10, 10)` is true.
- **Status:** OPEN

### S4-H7 — Exhausted agent jobs left runs queued

- **Severity:** High
- **Location:** `apps/worker/src/processor.ts` `markFinalFailure`. Before this audit it returned immediately unless the job was `foundation.ping`.
- **Reproduction:** Publish `agent.run` with `attempts: 5`. After the last failure, `queue.add` with the same job id is ignored as `already exists`. The run stayed `QUEUED` and the outbox stayed `PENDING`.
- **Impact:** The inspector showed a run that would not start again and would not become a terminal failure.
- **Correction:** Applied. On the final attempt, a run still in `QUEUED` or `RUNNING` becomes `FAILED_FINAL` with `errorCode` `EXHAUSTED`, and that outbox row becomes `FAILED`. Earlier attempts do not change the run.
- **Test:** `apps/worker/src/agent-run.spec.ts` “records an exhausted agent job as failed instead of leaving the run queued”.
- **Status:** FIXED

## Medium

### S4-M1 — In-flight pause, cancel, and suspension can lose the race

- **Severity:** Medium
- **Location:** `executeAgentRun` holds one interactive transaction from `RUNNING` through the final state. `withTenant` does not read tenant status. The worker job has no user id.
- **Reproduction:** Cancel or suspend the organization while `generate` is in progress. The executor can commit `SUCCEEDED` after the cancel, or keep running after suspension.
- **Impact:** A cancelled or suspended tenant can still receive a completed run from work that started earlier. There is no checkpoint that would let the worker stop at the next step.
- **Correction:** Commit `RUNNING` first. Re-read run state, tenant status, and automation status before the side effect. Do not overwrite `CANCELLED`.
- **Test:** None for this race.
- **Status:** OPEN

### S4-M2 — Policy inputs that exist in the function are not loaded

- **Severity:** Medium
- **Location:** `executeAgentRun` policy context. `AutomationPolicy.channel` and `actionType` are unused by `decide`.
- **Reproduction:** Create a policy with a channel. Run a scan. The decision does not mention that channel. Opt-out cannot occur because `suppressed` is constant `false`.
- **Impact:** The unit tests overstate what a live run will enforce. `A1`–`A3` do not grant or withhold anything different from the final external branch.
- **Correction:** Pass only facts loaded from tenant data. Until suppression and ownership tables exist, record the missing fact in the step detail instead of silently sending `false` once those tables are the source of truth.
- **Test:** `policy.spec.ts` covers the function, not the executor inputs.
- **Status:** OPEN

### S4-M3 — No rate limit on run creation

- **Severity:** Medium
- **Location:** `apps/api/src` has no throttler. `runs/create` is an authenticated CSRF-protected POST.
- **Reproduction:** A member with `agents.manage` can create runs until the database or the queue rejects the insert. Page size is capped at 100. Run creation is not.
- **Impact:** One organization can fill `agent_runs`, `llm_usage`, and the shared BullMQ queue.
- **Correction:** Add a per-session and per-tenant limit on `runs/create`, separate from the monthly model budget.
- **Test:** None.
- **Status:** OPEN

### S4-M4 — Command Center mixes live status with prototype controls

- **Severity:** Medium
- **Location:** `apps/web/components/SalesOS.jsx` renders `CommandDesk` and then the original KPI grid and supervisor hero.
- **Reproduction:** Sign in and open Command Center. The automation panel talks to the API. The hero badge and “Run” style prototype controls still change local `store.supervisor` and toast a simulated cycle.
- **Impact:** A user can pause the local hero and believe the organization is paused, or the reverse. The KPI cards are marked `demo data`. The hero is not.
- **Correction:** Keep the prototype only for the unsigned demo. On a signed-in command page, remove or clearly disable the local supervisor controls so they cannot be confused with `automation/pause`.
- **Test:** Playwright checks the live heading and toasts. It does not assert the hero is absent.
- **Status:** OPEN. Not changed in this audit because the task forbids a frontend redesign. The finding stands.

### S4-M5 — Replay can finish before the parent link is stored

- **Severity:** Medium
- **Location:** `AgentsService.replayRun` calls `createRun`, which may execute inline, then updates `parentRunId`.
- **Reproduction:** Replay a run in inline mode. The child can reach `SUCCEEDED` before `parentRunId` is written. A reader during that window sees no parent.
- **Impact:** The inspector can briefly show an unlinked attempt. The link is metadata. It does not cause a second send by itself.
- **Correction:** Insert the child row with `parentRunId` already set.
- **Test:** None.
- **Status:** OPEN

## Low

### S4-L1 — Design mapping and architecture text disagree with the code

- **Severity:** Low
- **Location:** `docs/SCREEN_API_MAPPING.md` says the mapping is design-only and lists different routes. `docs/ARCHITECTURE.md` §5.1 still says the LLM port is not implemented code.
- **Impact:** A later sprint can implement the wrong contract.
- **Correction:** Point the mapping at the management routes that exist, and state that the HTTP adapter is unused.
- **Status:** OPEN. This audit did not rewrite those design pages except through the new audit documents.

### S4-L2 — First Playwright launch in this audit could not find the browser

- **Severity:** Low
- **Location:** `PLAYWRIGHT_BROWSERS_PATH` was a sandbox cache without the binary. The user cache at `$HOME/Library/Caches/ms-playwright` has the browser.
- **Impact:** The first `pnpm test:e2e` exited 1 before any assertion. The retry exited 0, 5 passed.
- **Correction:** Do not point Playwright at an empty cache when reporting a product failure.
- **Status:** OPEN as an environment note. No product code changed.

## Items checked and not filed as defects

- Sort allowlist rejects `name; drop table agent_runs` with 400.
- CSRF middleware rejects cookie POST without `x-salesos-csrf: 1`.
- Agent routes use `SessionGuard` and `RequirePermissions`.
- Application and worker roles cannot `DELETE` the agent tables. `salesos_identity` has no grant on them.
- `set_automation_status` cannot set an arbitrary status and cannot update a different tenant than `app.tenant_id`.
- Public agent responses do not include ciphertext or a storage path. They do include the instructions the owner saved.
- Prompt bodies are not written at info level by the agent job.
