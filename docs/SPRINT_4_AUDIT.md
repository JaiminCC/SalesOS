# Sprint 4 final technical audit

**Date:** 5 November 2026  
**Role:** Independent audit of the implemented Sprint 4 runtime.  
**Scope:** Phase 4 in `docs/IMPLEMENTATION_PLAN.md` (T4.1–T4.5), `docs/ARCHITECTURE.md` §5 and §16, and `docs/AGENT_CONTEXT_CONTRACT.md`.  
**Method:** Read the executing code and tests. Do not treat a screen label, a filename, or a test title as proof.  
**Sprint 5:** Not started. Nothing was committed or pushed.

## 1. Audit summary

**Verdict: FAIL — Core AI runtime incomplete.**

Sprint 4 delivered a real management API and a durable row model for agents, runs, steps, actions, policies, and model-usage counters. Signed-in AI Agents and Execution Inspector screens read those rows through the Sprint 3.1 management kit. A test or scan run persists steps and an action. Cross-tenant run reads return 404. History is not exposed through a delete route, and SQL `DELETE` is rejected by trigger.

The path the audit was asked to prove does not exist:

> An authenticated user starts a run using approved product knowledge, invokes a configured model through the worker, executes authorized tools, and inspects the persisted decisions and output.

What exists instead is a session-authenticated enqueue, then `FakeLlmProvider`, which returns `NO_ACTION` for `TEST` and `CREATE_TASK` for every other trigger. The executor marks that internal proposal `SUCCEEDED` with `sent: false`. It does not load a published product version, does not retrieve approved knowledge, and does not call a tool. `HttpStructuredLlm` is never constructed. No environment variable names a model endpoint or a credential, so no real provider was invoked and none was smoke-tested.

Policy is a pure function and is called. It cannot currently allow an external send: every external action becomes `REQUIRE_APPROVAL` or `BLOCK`. There is no API to approve or reject that action. The Approval Center still edits local prototype data.

One High recovery defect was fixed during this audit: an exhausted `agent.run` job now writes `FAILED_FINAL` / `EXHAUSTED` instead of leaving the run `QUEUED`. The remaining High findings are architectural and were not rewritten here.

## 2. Actual implemented AI capabilities

| Capability | Classification | Evidence |
| --- | --- | --- |
| Agent profile CRUD, pause, resume, archive | REAL management | `AgentsService` and `AgentsController` under `apps/api/src/agents/`. Playwright creates, edits, reloads, and archives `Field Agent`. |
| Scan and test enqueue | REAL persistence, MOCK decision | `createRun` inserts `agent_runs` and an outbox row. Inline mode calls `executeAgentRun`. The proposal is `FakeLlmProvider`. |
| Execution inspector | REAL read model | `runRecord` loads steps and actions. `RunsDesk` renders `record.steps`. |
| Deterministic policy function | REAL function, PARTIAL wiring | `decide()` in `packages/shared/src/policy.ts`. The executor always passes `suppressed: false` and `humanOwned: false`. |
| Monthly budget stop | REAL comparison, MOCK cost | `budgetStop` compares summed `cost_minor` with `llm_monthly_budget_minor`. Cost stored is `inputTokens + outputTokens`, not a configured rate. Default limit is `1000000`. |
| Configured model call | NOT IMPLEMENTED | `propose()` and `processAgentRunJob` hardcode `new FakeLlmProvider()`. |
| Product research | MISSING | No tool and no call to product context. |
| ICP analysis | MISSING on the run path | ICP rows exist for products. The agent executor does not read them. |
| Sales strategy | MISSING | No planner output and no strategy tool. |
| Knowledge answering | MISSING on the run path | `ProductsService.preview` retrieves approved chunks. No agent run calls it. |
| Human approval of an agent action | NOT IMPLEMENTED | State `NEEDS_APPROVAL` can be stored. No decision route. |
| Outbound send | Not available | API and worker `sendExternal` always throw status 503. The fake proposal is internal, so that throw is not reached on the normal path. |

`REAL` means the code reads or writes tenant data or enforces a check. `MOCK` means the branch returns a fixed test value. `SIMULATED` means only the browser prototype changes. `MISSING` means the code path was not found.

## 3. Real, mock, and simulated features

- **Real:** profiles, policies, runs, steps, actions, usage rows, audit events, navigation tokens, pause of organization automation, archive, RLS, delete trigger, redaction of emails and secret-shaped fields before `input_redacted`.
- **Mock:** `FakeLlmProvider.generateStructured` for task `agent.propose`. `TEST` becomes `NO_ACTION`. Anything else becomes `CREATE_TASK` with summary `Internal coordination only`. Usage is a small integer, model name `fake-1`, provider string `fake`.
- **Simulated:** unsigned-in agent grid and inspector; signed-in Command Center KPI cards and the local “AI Sales Supervisor” hero, which still sit under the live automation panel and are labeled `demo data`; Approval Center; model preference dropdown in workspace settings; leads, campaigns, conversations, meetings, analytics, SSO, integrations, WhatsApp, and webhooks.

## 4. Model gateway verification

| Check | Result |
| --- | --- |
| 1. Configured hosted provider | NOT IMPLEMENTED. No provider env key. `HttpStructuredLlm` is not constructed. |
| 2. Configured self-hosted endpoint | NOT IMPLEMENTED. Same class, no selector. |
| 3. Deterministic test model | PASS as the only runtime model. Class `FakeLlmProvider` in `packages/agent-core/src/llm.ts`. |
| 4. Availability validation | FAIL. Nothing probes a provider before a run. The HTTP class throws if `fetch` is missing. |
| 5. Structured output validation | PARTIAL. `acceptProposal` allows nine action names. `generateWithRepair` retries once. |
| 6. Timeouts | PARTIAL. The call sites pass `timeoutMs: 1000`. `FakeLlmProvider` ignores it. `HttpStructuredLlm` passes `AbortSignal.timeout` and is unused. |
| 7. Bounded retries | PARTIAL. One schema repair. BullMQ job attempts are 5 for outbox jobs. The model itself is not retried on provider errors inside `generateWithRepair`. |
| 8. Provider error normalization | PARTIAL. `LlmProviderError` exists. The executor only special-cases `LlmSchemaError` and HTTP 503 from `sendExternal`. Other generate errors abort the transaction. |
| 9. Secure credentials | NOT IMPLEMENTED. `HttpStructuredLlm` sends no `Authorization` header. No encrypted provider secret table is read. |
| 10. Tenant-specific configuration | FAIL. Column `tenants.llm_provider` defaults to `fake`. `read_automation_settings` returns it. `executeAgentRun` does not use the field. |
| 11. Usage metrics | PARTIAL. One `llm_usage` row per successful proposal: provider, model, token counts, `cost_minor`. |
| 12. Token accounting | PARTIAL. Fake usage is message count and 1 output token, or 1 and 1 for a scripted call. |
| 13. Cost accounting when rates are configured | NOT IMPLEMENTED. No rate table. `cost_minor` is the sum of the two token counts. |
| 14. Model identifier persistence | PARTIAL. `agent_runs.model_provider` and `model_name` are set from the generator return value, which the API and worker force to `fake` / `fake-1`. |
| 15. Provider request traceability | FAIL. `traceId` is computed and discarded. No request id is stored. |
| 16. Quota enforcement | PARTIAL. `budgetStop` can skip the generator when monthly `cost_minor` is at least the tenant limit. No integration test drives a run over the limit. |
| 17. Maximum context safeguards | NOT IMPLEMENTED. No context-window or prompt-size cap. Summary is sliced to 240 characters only inside `acceptProposal`. |

**Exact class:** `FakeLlmProvider`.  
**Invocation:** `AgentsController.createRun` → `AgentsService.createRun` → outbox `agent.run.requested.v1`. If `SALESOS_PROCESS_AGENTS=inline`, the API calls `executeAgentRun` immediately. Otherwise `publishPendingOutbox` enqueues `agent.run` and `processAgentRunJob` calls `executeAgentRun`. Both generators call `generateWithRepair(new FakeLlmProvider(), …)`.  
**External requests made by this path:** none.  
**Real inference:** not claimed. No smoke test was run. `.env` has no key whose name matches `LLM`, `OLLAMA`, `OPENAI`, `ANTHROPIC`, or `MODEL`.

## 5. Supervisor execution trace

1. Session guard and `agents.manage` allow `POST /api/v1/management/runs/create`.
2. `withTenant` sets `app.tenant_id` for the insert. It does not check that the tenant is active. The session guard is what blocks a suspended organization on the API request. The worker does not repeat that check.
3. `ensureAgent` loads an active enabled profile or creates `Sales supervisor`.
4. The run is inserted `QUEUED`. Optional `productVersionId` is stored with no existence, publication, or tenant-ownership check. There is no foreign key.
5. An outbox row is inserted. Payload is `{ runId }` plus the job later carries `tenantId` and `outboxId` only.
6. `executeAgentRun` sets `RUNNING`, writes a `load` step, sums this month’s usage, and calls the generator inside the same database transaction.
7. The fake model returns one internal action. There is no goal check, no planner, no capability choice, and no tool call.
8. `decide()` runs. Internal actions are `ALLOW` / `INTERNAL`. The action is inserted `POLICY_CHECKED` and then updated to `SUCCEEDED`.
9. Steps `load`, `policy`, and `execute` are persisted. The run closes `SUCCEEDED`. The outbox row is marked `PROCESSED` when `outboxId` was passed.
10. `runRecord` returns the run, steps, and actions to the inspector.

There is no checkpoint between model call and commit. A crash before commit rolls the transaction back and leaves the run `QUEUED`. A second delivery of a terminal run returns the stored state and does not create a second proposal action. That duplicate case is tested in `apps/worker/src/agent-run.spec.ts`.

The architecture loop (wake on mail, approvals, stale leads, and meetings; priorities P0–P3; one of eight action types chosen from facts) is not implemented. The only bound is that the current function asks for one proposal and then stops. There is no enforced maximum for steps, tool calls, model requests beyond the single repair, wall-clock duration, or prompt tokens.

Invalid or contradictory plans were not executed against a planner because there is no planner. `acceptProposal` rejects an unknown `actionType`. A second invalid payload becomes `FAILED_FINAL` and an `ESCALATE` action. That path is tested with a thrown `LlmSchemaError`, not with a live model.

## 6. Tool policy results

No tool is registered. `packages/integrations` has no `generateStructured` implementation. `acceptProposal` is an allowlist of action name strings, not a tool schema.

| Required tool attribute | Result |
| --- | --- |
| Name, version, input schema, output schema | Absent |
| Permission, tenant scope, risk, approval, idempotency, timeout | Absent as tool metadata. Risk is `HIGH` if `external` is true, otherwise `LOW`. Idempotency key is `${runId}:proposal`. |

`decide()` does not trust `modelRequiresApproval`; the field is never read. Commercial phrases `price guarantee`, `discount`, `contract`, `legal assurance`, and `warranty of outcome` force `REQUIRE_APPROVAL`. A kill switch blocks external actions and allows internal ones. Those branches are unit-tested.

The executor never loads suppression or human ownership, so opt-out and human takeover cannot fire on a real run. Policy columns `channel` and `actionType` are stored and not consulted. Autonomy `A1`, `A2`, and `A3` do not change the result: the final branch of `decide()` returns `REQUIRE_APPROVAL` for every remaining external action.

No agent path executes SQL, a shell command, or an arbitrary network request from model text. The model text is stored in a redacted JSON payload. That is a consequence of there being no tool runner, not of a reviewed tool sandbox.

Unauthorized tool execution, unapproved document references, prompt injection through knowledge, expired approval, and missing approval were not runnable as tool tests. Knowledge injection remains a requirement of `docs/AGENT_CONTEXT_CONTRACT.md` and is untested on this path because the path does not read knowledge.

## 7. Approval system results

**Result: FAIL.**

`executeAgentRun` can set an action to `NEEDS_APPROVAL` and the run to `WAITING_APPROVAL`. Searches of `apps/api/src/agents` found no approve, reject, expire, or inbox route. `agent_actions.approved_by` and `due_at` are unused by the executor. Product-version approval and knowledge approval from Sprint 3 remain, and they do not decide an agent action.

The Approval Center page maps `store.approvals` in the browser. Those buttons do not call the agent API. An approval therefore cannot send mail, and it also cannot record a real decision. This audit does not describe that screen as a successful simulated approval workflow.

Not present: approval creation as its own record, permission recheck at decision time, single-decision enforcement, concurrent decision handling, payload binding, expiry, or revocation when a membership is removed.

## 8. Worker recovery results

Traced path: `createRun` writes `outbox_events` → `publishPendingOutbox` → BullMQ job name `agent.run` with ids only → `processAgentRunJob` → `executeAgentRun` → `runs/get`.

| # | Case | Result | Evidence |
| --- | --- | --- | --- |
| 1 | Normal successful run | PASS for the fake internal proposal | API integration: `TEST` returns `SUCCEEDED`, steps length > 0, `sent: false`. |
| 2 | Failed model schema | PASS for a thrown `LlmSchemaError` | Worker spec escalates and closes `FAILED_FINAL`. A live malformed HTTP body was not sent. |
| 3 | Model timeout | NOT TESTED | Fake provider does not time out. HTTP adapter is unused. |
| 4 | Redis outage during submit | NOT TESTED against Redis | `publishPendingOutbox` rethrows queue errors other than `already exists`. `recovery.spec.ts` covers that throw for the publisher. The run row would stay `QUEUED` and the outbox `PENDING`. |
| 5 | Worker stopped before processing | PASS by code, not by stopping a process | The outbox stays `PENDING` until `queue.add` succeeds. No process was killed. |
| 6 | Worker crash during a run | PARTIAL | The whole run is one transaction. A crash before commit rolls back. No mid-flight checkpoint remains. |
| 7 | Restart and recovery | PARTIAL | Pending outbox can be published again. A BullMQ job id that already exists is ignored. |
| 8 | Duplicate delivery | PASS | Same run executed twice yields one action. |
| 9 | Concurrent pickup | NOT TESTED | No two-worker test. |
| 10 | Pause while running | FAIL | Pause is a second transaction. It cannot see the run until the executor commits, by which point the run is already terminal. |
| 11 | Resume after pause | PARTIAL | `resumeRun` sets `QUEUED` and enqueues. If the action is already terminal, `executeAgentRun` returns that state and does not call `decide()` again. A `PAUSED` or `READY` action goes to `finishExternal` without a new policy decision. |
| 12 | Cancel while running | PARTIAL | Cancel is allowed from `RUNNING`, but the in-flight transaction can commit afterward and overwrite the cancelled state. |
| 13 | Resume after cancellation | PASS as a conflict | `resumeRun` requires state `PAUSED` and returns 409 otherwise. |
| 14 | Expired approval | NOT IMPLEMENTED | No expiry writer. |
| 15 | Database outage | NOT TESTED | No connection was severed. |
| 16 | Tenant suspension during execution | FAIL | Worker does not read tenant status. `withTenant` only sets the tenant id. |
| 17 | Role revocation during execution | FAIL for in-flight work | The job has no user id. Removal stops later API calls through the session guard. It does not stop a job already queued. |
| 18 | Resource-limit exceeded | PARTIAL | `budgetStop` exists. No run was driven over the default limit of `1000000`. |

No live Redis or Postgres service was stopped. Development jobs were not flushed.

## 9. Product provenance results

`POST /api/v1/products/:id/context/preview` still returns published context, citations, and `provenance.versionId`. Sprint 3 tests still exclude rejected and foreign knowledge from that response. Sprint 4 runs do not call it.

A run does not persist product id, a verified version id, source provenance, or citation references. `product_version_id` is an optional unchecked UUID. Publishing or superseding a version cannot alter an existing run’s context because the run never stored that context. That is absence, not a snapshot guarantee.

Unpublished, rejected, and deleted documents are not excluded on the agent path because they are not queried. Cross-tenant retrieval is denied for the product preview API. It was not exercised through an agent run.

## 10. Tenant security results

| Check | Result |
| --- | --- |
| Migration `20261105120000_agent_runtime` | Applied. Six tables, forced RLS, `tenant_isolation` policy, delete trigger, `SELECT/INSERT/UPDATE` for `salesos_app` and `salesos_worker`, `REVOKE ALL` from `salesos_identity`. |
| `read_automation_settings` / `set_automation_status` | Security definer. The target must equal `app.tenant_id`. Pause accepts only `RUNNING` or `PAUSED`. Execute on the setter is granted to `salesos_app` only. |
| Session and permission guards | Present on `AgentsController`. CSRF middleware rejects cookie mutations without `x-salesos-csrf: 1`. |
| Navigation | `agent`, `agent_run`, and `automation_policy` resolve through the owning service under the session tenant. |
| Unauthorized run start | Enforced by guards. This audit did not add a new unauthenticated request. |
| Cross-tenant run read | PASS. Integration expects 404. |
| Cross-tenant artifact read | PASS for steps and actions, because `runRecord` loads them only after the run is visible in the tenant transaction. |
| Cross-tenant approval | Not applicable. No agent approval route. |
| Forged agent id | `ensureAgent` looks up `(tenantId, id)` and rejects archived or disabled profiles with 404. |
| Forged product version id | FAIL. Any UUID is stored. |
| Sort injection | PASS. `name; drop table agent_runs` returns 400. Search uses Prisma `contains`. |
| Rate limit | NOT IMPLEMENTED. No throttler on the API. |
| Oversized payload | PARTIAL. DTO max lengths exist (`q` 200, name 120, instructions 2000, page size 100). |
| Error leakage | Agent errors seen in code are fixed messages (`Agent was not found`, schema mismatch, mailbox is not configured). Provider secrets cannot leak because none are loaded. |
| Prompt logging | No info log in the executor or agent job writes the prompt. Worker failures log `error.message` and `jobId`. |
| Credential encryption | NOT IMPLEMENTED for model credentials. |
| Browser URLs | Playwright asserts the edit URL has no UUID. Ids are still accepted in JSON bodies and are authorized with the session tenant. |

No Critical cross-tenant read or credential disclosure was reproduced.

## 11. Management UI coverage

Signed-in agents and inspector use `kit.jsx`, server lists, dedicated add/view/edit for agents, confirmation dialogs, and bulk pause, archive, and cancel. Details are in `docs/SPRINT_4_UI_AUDIT.md`.

Unsigned-in routes do not mount `AgentsDesk`, `RunsDesk`, or `CommandDesk`. The prototype grids remain. They do not call `managementRequest`.

There is no model-configuration management module. The settings model control is local component state.

## 12. Exact test outcomes

| Command | Exit | Count |
| --- | --- | --- |
| `pnpm lint` | 0 | eslint completed |
| `pnpm typecheck` | 0 | packages and apps typecheck completed |
| `pnpm test` | 0 | shared 18, agent-core 3, integrations 1, database 15, API 33, worker 11, web secret scan PASS |
| `pnpm check:source` | 0 | source syntax and feature checks PASS |
| `NODE_ENV=production pnpm --filter @salesos/web build` | 0 | Next.js production build completed |
| `pnpm test:e2e` | 0 on retry | 5 passed (47.2s) |

The first e2e invocation in this audit exited 1 because `PLAYWRIGHT_BROWSERS_PATH` pointed at a sandbox cache without the browser binary. The retry used `$HOME/Library/Caches/ms-playwright`. That failure is environmental, not an application assertion.

Playwright `e2e/agents.spec.ts` covers scan, organization pause and resume, test run with no `sent: true` action, agent create, edit, reload, a second tab on a different agent, and archive. It does not cover per-run cancel, per-run pause, an approval decision, a viewer denial, or a step-by-step inspector assertion beyond the toast. Worker integration uses PostgreSQL. The foundation retry spec uses Redis. The new exhausted-agent test calls `markFinalFailure` directly and does not kill a worker process.

## 13. Critical and High findings

No Critical finding was reproduced.

High findings, all still open except the exhausted-job status:

- Configured model is never called.
- Agent approvals do not exist.
- Runs do not use approved product knowledge.
- No tool execution boundary.
- Resume does not re-run policy, and per-agent pause does not stop queued work.
- Execution limits and real cost quota are not enforced.
- Exhausted agent jobs used to leave runs `QUEUED`. **Fixed** in `markFinalFailure`.

Details, reproduction, and status are in `docs/SPRINT_4_SECURITY_FINDINGS.md`.

## 14. Sprint 4 acceptance matrix

See `docs/SPRINT_4_REQUIREMENTS_MATRIX.md`. T4.1 is largely PASS. T4.2 is PARTIAL. T4.3, T4.4, and T4.5 are PARTIAL. The Phase 4 exit (ST-013 and ST-016 against a fake mailbox, with inspector steps and an effective global pause) is not fully met: inspector steps are real, global pause blocks a pre-seeded `READY` external action in the worker spec, and ST-013 also depends on T8.4, which is not this sprint. A full mailbox assertion does not exist because there is no `messages` table.

## 15. Sprint 5 readiness

**Not ready.** See `docs/SPRINT_4_READINESS.md`.

## Correction made during the audit

`apps/worker/src/processor.ts` `markFinalFailure` now, after the last attempt, sets an `agent.run` job’s run to `FAILED_FINAL` / `EXHAUSTED` when the run is still `QUEUED` or `RUNNING`, and marks that outbox row `FAILED`. Earlier attempts leave the run queued. `apps/worker/src/agent-run.spec.ts` covers both. No other runtime behavior was changed.
