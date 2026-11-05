# Sprint 4.1 completion

**Date:** 5 November 2026  
**Scope:** Remediate the Sprint 4 audit blockers and run the supervisor on pinned product context. Sprint 5 was not started. Nothing was committed.

## Migration

`packages/database/prisma/migrations/20261105140000_agent_supervisor/migration.sql` is forward-only and applied to the local `salesos` database.

It adds model, product, goal, snapshot, plan, report, and lease columns on the existing agent tables. New forced-RLS tables: `model_configurations`, `agent_approvals`, `agent_tool_calls`, `usage_counters`. `read_execution_gate` returns organization status, automation status, and the monthly budget to `salesos_app` and `salesos_worker` only. Delete triggers match the existing agent-history rule.

## High findings

| ID | Previous defect | Root cause | Fix | Test | Status |
| --- | --- | --- | --- | --- | --- |
| S4-H1 | The configured model was never called | API and worker constructed `FakeLlmProvider` | `readModelSelection` plus `createModelClient`. Fake only when the row says `fake` | `gateway.spec.ts`, agent integration | PASS. Live smoke NOT TESTED |
| S4-H2 | No approval inbox | No approval table or decision route | `agent_approvals` and `approvals/decide`. Approve does not send | `agents.integration.spec.ts` | PASS |
| S4-H3 | Runs ignored approved product knowledge | `productVersionId` was unchecked | `loadPublishedContext` pins the published snapshot | Integration rejects a draft and stores `contextSha256` | PASS |
| S4-H4 | No tool boundary | One proposal string, no registry | `TOOL_REGISTRY` and checkpoint execution | Recovery spec asserts the plan tools | PASS |
| S4-H5 | Resume skipped policy; agent pause did not stop work | Resume requeued the old executor | Resume rechecks membership, version, model, and `decide()`. A non-active agent cannot start, and a checkpoint pauses | Code in `resumeRun` and `claimAndPrepare`. Cancel-during-callback test | PASS |
| S4-H6 | Limits used token counts as cost | No price or reservation | `estimateCostMinor` and `usage_counters` | `limits.spec.ts`, quota test | PASS |
| S4-H7 | Exhausted jobs left runs queued | `markFinalFailure` ignored agent jobs | Already fixed in the audit | `agent-run.spec.ts` | PASS |

## Execution trace

A test run with a draft goal executes `product.context.read`, `product.icp.read`, `product.positioning.read`, `product.knowledge.search`, `research.report.create`, `sales.strategy.generate`, `sales.message.draft`, and `action.proposal.create`. The last step inserts `NEEDS_APPROVAL`. Approval sets `APPROVED_NOT_EXECUTABLE` and `sent: false`.

## Adapters

`fake`, `openai_compatible` (HTTPS or explicit loopback HTTP), and `ollama`. SSRF checks live in `packages/agent-core/src/ssrf.ts`.

## Command results

Filled after the verification commands in this session. See the final report if this section still says pending.

| Command | Exit |
| --- | --- |
| `pnpm lint` | 0 |
| `pnpm typecheck` | 0 |
| `pnpm test` | 0 |
| `pnpm check:source` | 0 |
| `NODE_ENV=production pnpm --filter @salesos/web build` | 0 |
| `pnpm test:e2e` | 0 (5 passed). An earlier full run exited 1 on the Approval Center button name; the selector was corrected and the suite was run again. |

## Sprint 5

Not ready. Hosted-model smoke is NOT TESTED. Suppression, human ownership, and quiet hours are still not sourced from lead data. External delivery remains disabled on purpose.
