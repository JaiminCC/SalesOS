# Sprint 4 requirements traceability

**Date:** 5 November 2026  
**Sprint 4.1 retest:** same day. The tables below this section are the audit baseline. Where Sprint 4.1 changed the result, the retest row wins.

## Sprint 4.1 retest

| Requirement | Status | Evidence |
| --- | --- | --- |
| Explicit model configuration and adapter | PASS | `model_configurations`, `createModelClient`, `gateway.spec.ts` |
| Hosted provider smoke | NOT TESTED | No credential in the environment |
| Published version pinned before enqueue | PASS | `agents.integration.spec.ts` rejects a draft and stores `contextSha256` |
| Bounded tool plan | PASS | `TOOL_REGISTRY`, `buildSupervisorPlan`, recovery spec tool list |
| Persistent approval, no send | PASS | Decision API and `APPROVED_NOT_EXECUTABLE` |
| Checkpoint, lease, and process recovery | PASS | `recovery.spec.ts` terminates a child process |
| Quota and price-based cost | PASS | Budget 0 and `limits.spec.ts` |
| Resume rechecks authorization and policy | PASS | `resumeRun` and `decide()` for pending actions |
| Signed-in command, models, inspector, and approvals use the management kit | PASS | Desks under `apps/web/components/management/` |
| A1–A3 differ, quiet hours, suppression from leads | PARTIAL | Unchanged. No lead tables in this sprint. |

**Sources:** `docs/IMPLEMENTATION_PLAN.md` Phase 4, `docs/ARCHITECTURE.md` §5 and §16, `docs/AGENT_CONTEXT_CONTRACT.md`.  
**Rule:** A row is PASS only where the cited code and a test, or a direct code read where no test exists, show the behavior. UI copy is not evidence.

No separate Sprint 4 design document existed before this audit. `docs/SCREEN_API_MAPPING.md` still describes a different, unwired route shape. It was not treated as the Sprint 4 contract.

## T4.1 Persist runs, steps, and actions

| Requirement | Implementation | API | Database | Test | Evidence | Status |
| --- | --- | --- | --- | --- | --- | --- |
| Tables migrate with forced RLS | `packages/database/prisma/migrations/20261105120000_agent_runtime/migration.sql` | — | `agent_profiles`, `automation_policies`, `agent_runs`, `agent_run_steps`, `agent_actions`, `llm_usage` | `migration-probe.spec.ts`, `isolation.spec.ts` | Tables are created, `FORCE ROW LEVEL SECURITY`, policy `tenant_isolation`. Names are listed in `tenant-tables.ts`. | PASS |
| Inspector reads steps from the API | `AgentsService.runRecord` | `POST /api/v1/management/runs/get` | `agent_run_steps` | `agents.integration.spec.ts` expects `steps.length > 0` | Steps are queried `orderBy position` and returned as `detail`. `RunsDesk` renders them. | PASS |
| Redact email and secrets before `input_redacted` | `redactValue` in `packages/shared/src/redact.ts`; called from `createRun` and again in `executeAgentRun` | — | `agent_runs.input_redacted` | `redact.spec.ts`; worker spec expects `[email]` and not `ada@example.com` | Emails, bearer tokens, and secret-like keys are replaced. | PASS |
| Cross-tenant run id is 404 | `runRecord` inside `withTenant` | `POST /api/v1/management/runs/get` | RLS | `agents.integration.spec.ts` | Other organization receives 404 for the created run id. | PASS |
| No hard delete of history | Trigger `reject_agent_history_delete`; grants omit `DELETE` | No `runs/delete` route. Integration expects 404. | All six agent tables | HTTP 404 only. This audit did not issue SQL `DELETE`. | Trigger raises `agent history cannot be hard-deleted`. | PASS for the API. PARTIAL for a live SQL delete attempt. |

## T4.2 Deterministic policy

| Requirement | Implementation | API | Database | Test | Evidence | Status |
| --- | --- | --- | --- | --- | --- | --- |
| `decide()` implements A0–A4 | `packages/shared/src/policy.ts` `decide` | Policy CRUD stores `autonomyLevel` | `automation_policies.autonomy_level` | `policy.spec.ts` does not vary A1–A3 | `A0` and `A4` are named. `A1`–`A3` fall through to the same `REQUIRE_APPROVAL` return as every other external action. | PARTIAL |
| Kill switch | `decide` reason `KILL_SWITCH`; executor sets `killSwitch` from `automation_status === 'PAUSED'` | `POST /api/v1/management/automation/pause` | `tenants.automation_status` via `set_automation_status` | `policy.spec.ts`; worker spec with a pre-seeded `READY` action | External is `BLOCK`. Internal `CREATE_TASK` is `ALLOW` in the unit test. | PASS |
| Suppression | `decide` reason `OPT_OUT` when `suppressed && external` | None | No suppression table | Unit test passes `suppressed: true` directly | `executeAgentRun` always passes `suppressed: false`. | PARTIAL |
| Human ownership | `decide` reason `HUMAN_OWNED` | None | No conversation ownership column read | No unit test for this branch | Executor always passes `humanOwned: false`. | PARTIAL |
| Commercial commitment never `ALLOW` | `textHasCommercialCommitment` and `commercialCommitment` branch | — | Stored on the action as `policyDecision` | `policy.spec.ts` with `modelRequiresApproval: false` | Decision is `REQUIRE_APPROVAL`, reason `COMMERCIAL_COMMITMENT`. | PASS |
| Model `requiresApproval` cannot force `ALLOW` | `decide` never reads `modelRequiresApproval` | — | — | Same unit test | The flag is not an input to the decision. | PASS |
| Policy version stored and not rewritten | `policyVersion` on the action. `updatePolicy` increments the policy row. | `POST /api/v1/management/policies/update` | `agent_actions.policy_version` | API spec and worker spec | Historical action stays on version `1` after the policy becomes version `2`. | PASS |
| Quiet hours and draft-matches-approved | Not present on `PolicyContext` | — | — | None | Architecture §5.4 names both. | NOT IMPLEMENTED |

## T4.3 LLM adapter and budgets

| Requirement | Implementation | API | Database | Test | Evidence | Status |
| --- | --- | --- | --- | --- | --- | --- |
| One HTTP adapter selected by tenant settings | `HttpStructuredLlm` in `packages/agent-core/src/http-llm.ts` | No model-config route | `tenants.llm_provider` default `fake` | None call the class | API and worker construct `FakeLlmProvider` only. The provider column is not read by the generator. | NOT IMPLEMENTED |
| Ollama and OpenAI-compatible configuration | The HTTP class posts `model`, `max_tokens`, `messages`, and `response_format`. It has no auth header and no base-URL allowlist. | — | — | None | No env key selects a base URL. | NOT IMPLEMENTED |
| Timeout, max tokens, one schema repair | `generateWithRepair`; call sites pass `timeoutMs: 1000` and `maxTokens: 200` | — | — | `repair.spec.ts` | One invalid scripted payload is repaired. A second invalid payload throws `LlmSchemaError`. Fake provider ignores timeout. | PARTIAL |
| Second invalid payload is `FAILED_FINAL` plus escalation | `executeAgentRun` catch for `LlmSchemaError` | — | `agent_actions` `ESCALATE` | Worker spec | State `FAILED_FINAL`, reason code `SCHEMA`. | PASS for a thrown schema error |
| `llm_usage` feeds a budget check | `budgetStop` after `llmUsage.aggregate` | — | `llm_usage.cost_minor`, `tenants.llm_monthly_budget_minor` | `policy.spec.ts` tests the comparison only | Over budget, the generator is skipped and the run is `FAILED_FINAL` / `BUDGET`. Cost is token count, not a rate. No run-level integration crosses the limit. | PARTIAL |
| Provider HTTP 503 does not mark a message sent | `finishExternal` on status 503 | — | `outcome.sent: false`, state `FAILED_RETRYABLE` | Worker spec seeds a `READY` action and a throwing sender | This is the mailbox stand-in, not an LLM HTTP 503. `HttpStructuredLlm` maps non-OK to `LlmProviderError`, and the executor rethrows that error unless it is a schema error. | PARTIAL |

## T4.4 Queue, idempotency, pause, resume, retries

| Requirement | Implementation | API | Database | Test | Evidence | Status |
| --- | --- | --- | --- | --- | --- | --- |
| Outbox publishes BullMQ jobs with ids only | `publishPendingOutbox` | — | `outbox_events` | `recovery.spec.ts` for the publisher. Agent branch is the same function. | Job data is `{ tenantId, runId: aggregate_id, outboxId }`. | PASS |
| Worker sets tenant context and reloads the action | `processAgentRunJob` uses `withTenant`, then `executeAgentRun` loads the run | — | `agent_runs`, `agent_actions` | Worker spec calls `executeAgentRun` with the worker role | The worker does not check session permissions. | PASS for tenant context |
| Pause sets `automation_status` and stops external executors | `AgentsService.setAutomation`; `finishExternal` checks status before `sendExternal` | `POST /api/v1/management/automation/pause` | `tenants` via security definer | Worker spec: paused `READY` action does not increment the send counter. Playwright clicks Pause automation. | Pause of one agent profile does not change that flag and does not remove a BullMQ job. | PARTIAL |
| Resume requeues and calls `decide()` again | `resumeRun` inserts a new outbox row and, inline, calls `executeAgentRun` | `POST /api/v1/management/runs/resume` | new `outbox_events` row | None for re-decision | Terminal actions return the old state. `PAUSED` or `READY` actions go to `finishExternal` without `decide()`. | FAIL |
| Attempts, backoff, dead-letter | `attempts: 5`, exponential backoff 200ms in `publishPendingOutbox` | — | — | Foundation retry spec uses Redis. Agent jobs were not failed inside BullMQ. | `markFinalFailure` now records exhausted agent runs. There is no separate dead-letter queue. | PARTIAL |
| Idempotency replay returns the original result | `executeAgentRun` returns when the proposal action is terminal | — | unique `(tenant_id, idempotency_key)` | Worker spec executes one run twice and counts one action | Key is `${runId}:proposal`. | PASS |
| Kill worker mid-job and restart to one succeeded action | Not implemented as a process kill | — | — | Duplicate in-process call only | A crashed transaction rolls back. This is not the AT-19 process-kill test. | PARTIAL |
| Duplicate outbox delivery does not duplicate the action | Same as idempotency | — | unique key | Worker spec | One action after two executions. | PASS |

## T4.5 Command Center and agents on the API

| Requirement | Implementation | API | Database | Test | Evidence | Status |
| --- | --- | --- | --- | --- | --- | --- |
| Run cycle enqueues a scan and shows the run | `CommandDesk` calls `runs/create` with `SCAN` and toasts the returned `state` | `POST /api/v1/management/runs/create` | `agent_runs` | Playwright expects `Scan finished as ` | Inline mode returns the finished run. Queue mode returns the run before the worker finishes, still from the database. The KPI panel below is prototype data. | PARTIAL |
| Pause and per-agent enable hit the API | Organization pause and resume call `automation/pause` and `automation/resume`. Agent pause calls `agents/pause`. | Those routes | `tenants.automation_status`, `agent_profiles.status` | Playwright covers organization pause and resume, not the per-agent switch | Per-agent pause is a real update. It does not disable queued runs. | PARTIAL |
| Test agent creates a run with no outbound message | `RunsDesk.testAgent` posts `triggerType: 'TEST'` | `runs/create` | `agent_actions.outcome` | Playwright and API integration | Fake model returns `NO_ACTION`. SQL count of `outcome.sent = true` is 0. There is no `messages` table to count. | PASS for “no send”. MOCK for the decision |
| Demo mode still works when the API is absent | `SalesOS.jsx` mounts the live desks only when `signedIn` | — | — | Not an offline test | Unsigned pages keep the prototype grids and do not call `managementRequest`. | PASS by code read |
| Playwright cycle, pause, and test agent | `apps/web/e2e/agents.spec.ts` | — | — | 1 passed in the 5-test e2e run | Cancel, approval, and viewer denial are not in that spec. | PARTIAL |

## Architecture §5 items beyond the task list

| Requirement | Status | Evidence |
| --- | --- | --- |
| Supervisor loads mail, approvals, leads, and meetings | NOT IMPLEMENTED | Generator input is the trigger string only. |
| Proposal persisted as `PROPOSED` before policy | FAIL | The first stored action state in `executeAgentRun` is `POLICY_CHECKED`. |
| `NEEDS_APPROVAL` waits for Approval Center | FAIL | State is stored. Approval Center does not read it. |
| Per-agent pause removes or delays the BullMQ job | NOT IMPLEMENTED | `pauseAgent` updates the profile row only. |
| Uncertain provider acceptance reconciled by provider id | NOT IMPLEMENTED | No provider message id. |
| Tool execution through named executors | NOT IMPLEMENTED | No registry. |
| Prompts not logged at info | PASS | No such log in the agent executor or job. |
| Monthly budget stops new model jobs | PARTIAL | See T4.3. Default limit is `1000000` minor units of token-count cost. |

## Agent context contract

| Requirement | Status | Evidence |
| --- | --- | --- |
| Future agent stores `provenance.versionId` | NOT IMPLEMENTED | `executeAgentRun` does not call `ProductsService.preview`. |
| Citations are untrusted data | NOT TESTED on the agent path | The run never loads chunk content. |
| Draft and rejected knowledge stay out of live context | PASS for the product preview API. NOT IMPLEMENTED for runs. | `products.integration.spec.ts` covers preview. Agent create accepts any `productVersionId`. |

## Phase 4 exit

| Exit criterion | Status |
| --- | --- |
| ST-013 | NOT MET. The story also depends on T8.4, which is outside Sprint 4. Scan and pause exist only in the partial form above. |
| ST-016 | PARTIAL. Runs and steps persist. Recovery is not proven for crash, timeout, or suspension. |
| Inspector shows real steps | PASS |
| Global pause is effective at the executor | PASS for a `READY` external action while `automation_status` is `PAUSED`. Not proven against an in-flight transaction. |
