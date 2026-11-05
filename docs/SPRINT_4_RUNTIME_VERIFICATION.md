# Sprint 4 runtime verification

**Date:** 5 November 2026  
**Real inference:** not invoked. No provider URL or credential is configured. No smoke call was made.

## Model gateway

| Item | Observed |
| --- | --- |
| Implementation class used on the API and worker | `FakeLlmProvider` (`packages/agent-core/src/llm.ts`) |
| Unused class | `HttpStructuredLlm` (`packages/agent-core/src/http-llm.ts`) |
| API path | `POST /api/v1/management/runs/create` → `AgentsService.createRun` → `propose()` → `generateWithRepair` |
| Worker path | `publishPendingOutbox` → BullMQ job `agent.run` → `processAgentRunJob` → the same `generateWithRepair` call |
| Provider requirement | None. `tenants.llm_provider` defaults to `fake` and is ignored. |
| External HTTP from this path | None observed in code. The fake class returns an object in memory. |
| Hardcoded response | Task `agent.propose`: content containing `TEST` returns `NO_ACTION`; otherwise `CREATE_TASK`, `external: false`, summary `Internal coordination only`, model `fake-1`. |

Deterministic tests that passed in `pnpm test`:

- `packages/agent-core/src/repair.spec.ts`: one invalid scripted payload is repaired; two invalid payloads throw `LlmSchemaError`.
- `packages/agent-core/src/llm.spec.ts`: the fake provider fills required schema keys for a non-agent task.
- `packages/shared/src/policy.spec.ts`: 5 tests, including budget arithmetic, opt-out, commercial commitment, and kill switch.
- `apps/worker/src/agent-run.spec.ts`: 4 tests, including duplicate delivery, paused send, schema escalation, and exhausted job status.

`generateWithRepair` was not pointed at a network endpoint.

## Supervisor trace

A `TEST` run in the API integration spec does the following, and the response asserts it:

1. The caller is a verified session with the organization cookie and `x-salesos-csrf: 1`.
2. The run is created in that tenant.
3. Inline execution finishes `SUCCEEDED`.
4. The first action outcome is `{ sent: false }`.
5. At least one step is returned.
6. The same id from another organization is 404.

What the same function does not do, confirmed by reading `executeAgentRun`:

- It does not validate a goal.
- It does not choose a product version.
- It does not build a multi-step plan.
- It does not select a capability.
- It does not invoke a tool.
- It writes steps named `load`, `policy`, and `execute` (or `budget` / `model` on those failures).
- It stores `model_provider`, `model_name`, and `prompt_version` `mvp-1` only after a proposal is accepted.
- It does not write a separate execution-event table. Audit rows are `agent.run.create`, pause, resume, cancel, and archive.

## Capability classification

| Capability | Class | Why |
| --- | --- | --- |
| Product research | MISSING | No function reads a product during the run. |
| ICP analysis | MISSING | No function reads ICP rows during the run. |
| Sales strategy | MISSING | No planner output is stored. |
| Knowledge answering | MISSING | `ProductsService.preview` is not called. |
| Internal proposal | MOCK | `FakeLlmProvider` returns a fixed action. |
| Policy decision | REAL | `decide()` runs on that fixed action and the result is stored. |
| External send | Not executed | Normal proposals are internal. A forced `READY` send throws 503 or is skipped when paused. |

## Bounds

| Limit | Enforced |
| --- | --- |
| Steps per run | No numeric cap. The current function writes a handful of steps and stops. |
| Tool invocations | No tools. |
| Model requests | One call, plus one repair inside `generateWithRepair`. |
| Provider retries | Not inside the model helper. BullMQ attempts are 5 at publish time. |
| Duration | `timeoutMs: 1000` is passed and ignored by the fake provider. |
| Tokens | Counted after the fake call. Not rejected against a context window. |
| Monthly cost | `budgetStop` compares summed token-count `cost_minor` with the tenant integer. Default `1000000`. |

An invalid action name does not pass `acceptProposal`. There is no planner to contradict, so a contradictory-plan test could not be run against the supervisor.

## Tool registry

Registered tools: none.

The string allowlist in `acceptProposal` is `RESEARCH_ACCOUNT`, `DRAFT_MESSAGE`, `QUALIFY_REPLY`, `PROPOSE_MEETING`, `SUMMARIZE_MEETING`, `CREATE_TASK`, `ESCALATE`, `NO_ACTION`, `SEND_EMAIL`. `SEND_EMAIL` and `DRAFT_MESSAGE` are treated as external. The fake provider does not emit them.

Unauthorized tool calls, invalid tool parameters, unapproved documents, and prompt injection through knowledge were not executable. Restricted commercial text is covered only by `decide()` on a string, not by a tool result.

## Approvals

| Check | Result |
| --- | --- |
| Create an approval for an agent action | Not implemented. The action state can be `NEEDS_APPROVAL`. |
| Inbox | Approval Center is prototype state in the browser. |
| Approve or reject | No route. |
| Expiry, single decision, concurrent decisions | Not implemented. |
| Bind to payload, organization, and run | Not implemented. |
| Recheck permission and membership | Not implemented. |
| Audit of a decision | Not implemented for agent actions. |
| Approval sends mail | Cannot. There is no decision handler and no mailbox send. |

## Durability matrix

Isolated process kills, Redis shutdown, and database shutdown were not performed. The development queue was left running.

| Case | Verification |
| --- | --- |
| Successful fake run | API integration, 201, `SUCCEEDED`. |
| Schema failure | Worker spec throws `LlmSchemaError`, expects `FAILED_FINAL`. |
| Model timeout | Not tested. No real or stubbed socket. |
| Redis unavailable at publish | Not retested here. Existing `recovery.spec.ts` expects `publishPendingOutbox` to throw when the queue add fails. |
| Worker not yet processing | Code: outbox remains `PENDING` until publish succeeds. |
| Crash during the transaction | Code: uncommitted work rolls back. No durable checkpoint inside the run. |
| Restart | Code: pending rows can be published again. An existing BullMQ job id is skipped. |
| Duplicate delivery | Worker spec: one action. |
| Two workers | Not tested. |
| Pause during the transaction | Not possible from a second session until commit. |
| Resume | Code does not call `decide()` for an existing terminal, `READY`, or `PAUSED` action. |
| Cancel | API allows it from `QUEUED`, `RUNNING`, `PAUSED`, `WAITING_APPROVAL`, and `FAILED_RETRYABLE`. No race test. |
| Resume of a cancelled run | Code returns 409 because the state is not `PAUSED`. |
| Expired approval | Not implemented. |
| Database down | Not tested. |
| Suspended tenant mid-run | Worker does not check suspension. |
| Removed member mid-run | Worker does not check the member. Later API calls use the existing session guard. |
| Over budget | Function exists. No fixture run was pushed over `1000000`. |
| Exhausted attempts | Fixed and tested through `markFinalFailure`. A live worker was not killed after five crashes. |

## Provenance

`executeAgentRun` does not read product, version, ICP, positioning, or knowledge tables. The optional `productVersionId` on the run is whatever UUID the client sent. Citations are not stored. The product preview service still has its own tests for unpublished and foreign content. Those tests do not start an agent run.

## Security checks exercised

| Check | Result |
| --- | --- |
| Cross-tenant run read | 404 in the API spec. |
| Sort injection | 400 in the API spec. |
| Missing delete route | 404 in the API spec. |
| RLS and migration replay | Database suite, 15 passed, including the migration probe. |
| Authenticated browser flow | Playwright agent spec passed on the retry. |
| Real provider credential handling | Not applicable. No credential is loaded. |
