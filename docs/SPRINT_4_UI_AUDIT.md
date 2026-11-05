# Sprint 4 management UI audit

**Date:** 5 November 2026  
**Framework:** `apps/web/components/management/kit.jsx`. No second UI framework was added.  
**Browser evidence:** `apps/web/e2e/agents.spec.ts` passed inside the 5-test Playwright run. Unsigned demo behavior was read from `SalesOS.jsx`, not clicked in this audit.

## Label rule

A screen is LIVE when the signed-in component calls `managementRequest` and renders the response. A screen is SIMULATED when it reads or writes `store` in the browser. A screen is MOCK when the API is real and the decision inside that API is `FakeLlmProvider`.

The agent and inspector headers say `LIVE AGENTS` and `LIVE EXECUTION`. They do not use the `LIVE DATA` badge used on products. The run is real. The model decision is mock. The header does not say that.

## Module results

| Module | Data | List | Search | Sort | Filter | Add | View | Edit | Lifecycle | Confirm | Bulk | Refresh | Two tabs | Empty / error | RBAC | Audit | Hard delete |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| AI Agents / profiles | LIVE rows | Yes, server page | Name | name, status, created | status | Yes | Yes | Yes | Pause, resume, archive | Yes | Pause, archive | Yes, Playwright reload keeps `Field Agent` | Yes, second tab opens `Sales supervisor` while the first keeps `Field Agent` | Loading, empty, error, missing token | `agents.manage` for forms. `automation.pause` for pause | `agent.create`, `agent.update`, `agent.pause`, `agent.resume`, `agent.archive` | No UI delete |
| Agent runs / inspector | LIVE rows, MOCK decision | Yes | Trigger and state | trigger, state, created | state | Test and scan buttons, not a form page | Yes | No edit page | Cancel, archive. API also has pause, resume, and replay. The view shows cancel and archive only | Yes | Cancel, archive | Token recall on view | Not covered for two run tabs | Loading, empty, error | `agents.manage` to start. `automation.pause` to cancel | `agent.run.create`, cancel, archive | No UI delete |
| Command Center | MIXED | Not a grid | No | No | Status text from `automation/get` | Scan button | Current status | No | Organization pause and resume | No confirm on organization pause | No | Status reloads after pause | Not tested | Loading and error on the live panel | `agents.manage` to scan. `automation.pause` to pause | `automation.pause`, `automation.resume`, `agent.run.create` | No |
| Approval inbox | SIMULATED | Prototype array | No | No | No | No | Local cards | No | Local approve and reject | No | No | Local state only | No | Prototype only | No server check | No agent-action audit | Local array filter only |
| Model configuration | NOT A MODULE | — | — | — | — | — | — | Settings dropdown is local state | — | — | — | — | — | — | — | — | — |
| Automation policies | API ONLY | `policies/list` exists | Name | name, version | status | No page | No page | No page | Archive API | — | — | — | — | — | `agents.manage` to write | `policy.create`, `policy.update`, `policy.archive` | No delete route |

## Agents

`AgentsDesk` is mounted only when `signedIn` is true. Add, view, and edit use navigation tokens stored in `sessionStorage`. The Playwright edit URL does not contain a UUID. Save calls `agents/create` or `agents/update` and toasts the API result. Archive, pause, resume, and both bulk actions open `ConfirmDialog` before the request. A failed request toasts `cause.message` and does not invent success.

The instructions field is saved and shown. It is not sent to the model. See `docs/SPRINT_4_RUNTIME_VERIFICATION.md`.

## Runs and inspector

`RunsDesk` lists through `runs/list` and opens `runs/get` after `openNavigation` for `agent_run`. The view prints step position, name, and status, then action type, policy decision, and state. Test agent posts `{ triggerType: 'TEST' }` and toasts the returned state plus “No outbound message was sent.” The Playwright SQL check found zero actions with `outcome.sent` true.

Cancel and archive confirm first. The copy says steps stay stored. The view does not offer run pause or resume even though those API routes exist. There is no edit form, which matches an immutable history row. There is no add form. Scan and test are the create actions.

Playwright does not open the inspector detail table, does not cancel a run, and does not sign in as a viewer and prove the add button is gone.

## Command Center

`CommandDesk` loads `automation/get`, enqueues `SCAN`, and calls pause or resume. Toasts use the returned state or the error message. Under that panel, the signed-in page still renders the prototype KPI grid (`demo data`) and the local supervisor hero. Those controls are SIMULATED and can be confused with the live pause button. This audit did not remove them.

## Approval inbox

The approvals page is the Sprint 1 prototype. It is mounted for signed-in and unsigned users. It does not call `managementRequest`. It is not an inbox for `NEEDS_APPROVAL` agent actions. Status: FAIL as an approval workflow, SIMULATED as a screen.

## Model configuration

No management screen reads or writes `tenants.llm_provider` or a credential. The workspace settings model control is component state. Status: NOT IMPLEMENTED.

## Unsigned demo

`page==='agents'&&!signedIn` and `page==='inspector'&&!signedIn` keep the original grids. `CommandDesk`, `AgentsDesk`, and `RunsDesk` are behind `signedIn`. Those prototype controls do not import `managementRequest`. A signed-out browser therefore does not invoke the agent API from these screens. Session and CSRF guards still apply if something else posts.

## Shared framework

Live agent pages use `ManagementPageLayout`, `DataTable`, `PaginationControls`, `SearchInput`, `FilterPanel`, `SortableColumnHeader`, `ConfirmDialog`, `EmptyState`, `ErrorState`, `LoadingState`, `PermissionGate`, and `RecordFormLayout`. That is the Sprint 3.1 kit. Product, member, and organization pages were not replaced.

## Browser coverage gap

Covered: agent create and edit, scan start, returned scan status, organization pause and resume, test run, no outbound `sent: true`, archive, reload, two-tab agent isolation, URL without a database id.

Not covered: run cancel, run pause and resume, approval decision, inspector step text, viewer denial, policy screens, model settings, and the simulated supervisor hero next to the live panel.
