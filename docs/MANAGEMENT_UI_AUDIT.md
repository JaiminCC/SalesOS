# Management UI audit

Sprint 3.1 inspected the SalesOS shell, the live product catalog, the enterprise pages, and the NestJS identity, product, and management APIs. A module is LIVE when the screen reads and writes the tenant database. A module is SIMULATED when the screen still uses prototype data and this sprint did not invent a backend for it.

Browser routes for live modules are `/workspace/{module}`, `/workspace/{module}/add`, `/workspace/{module}/view`, and `/workspace/{module}/edit`. Those paths do not contain database ids. The selected record is a server-side navigation context. See `docs/SECURE_NAVIGATION.md`.

Existing `/api/v1/products`, `/api/v1/organizations`, and `/api/v1/auth` routes stay. New item operations are `POST /api/v1/management/...` with the identifier in the body.

## Screen-to-API matrix

| Module | Source | List | Create | Detail | Update | Delete or lifecycle | Bulk | Page | Sort | Search | Filter |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Members | LIVE | `management/members/list` | `members/invite` | `members/get` | `members/update` | `members/remove` (membership only) | `members/bulk-remove` | Yes | name, email, role, status, joined | Name in SQL; exact email by HMAC; partial email limited to 100 rows | Role, status |
| Organizations | LIVE | `organizations/list` | `organizations/create` | `organizations/get` | `organizations/update` | Suspend or restore via status | None | Yes | name, status | Name | Status |
| Roles | LIVE read-only | `roles/list` | None | Matrix on the users screen | None | None | None | Full catalog | Server order | None | None |
| Invitations | LIVE | `invitations/list` | Same invitation workflow as Add User | List row | None | `invitations/revoke` | `invitations/bulk-revoke` | Yes | created | None (email is not stored in clear text) | Status |
| Sessions | LIVE | `sessions/list` | None | Own sessions | None | `sessions/revoke` | `sessions/bulk-revoke` of the caller's sessions | Yes | created | None | None |
| Audit | LIVE read-only | `audit/list` | Append-only writers elsewhere | List row | None. `management/audit/update` is not a route | None | None | Yes | created | Action and entity type | None |
| Products | LIVE | `products` and `management/products/list` | Both create routes | `products/:id` and `management/products/get` | Both update routes | Archive and restore | Archive and restore | Yes | name, type, status, created, updated | Name, category, short description | Type, status |
| Product versions | LIVE | Version list on the product and `management/versions/list` | Draft create | Version get | Draft update | Submit, approve, reject, publish, archive draft, restore as a new draft | None | Yes | Version number | None | Status |
| ICPs | LIVE | Product tab and `management/icps/list` | Both create routes | `icps/get` | `icps/update` | Archive | `icps/bulk-archive` | Yes | name, priority | Name | Archived state |
| Positioning, pricing, objections, qualification, restrictions | LIVE | Inside the open draft | Saved with the draft | Draft snapshot | Draft update with revision | Not a separate delete | None | Not a grid | Not a grid | Not a grid | Not a grid |
| Organization defaults | LIVE | Single record | Created with the organization | `defaults/get` | `defaults/update` with `expectedUpdatedAt` | None | None | Not a grid | Not a grid | Not a grid | Not a grid |
| Knowledge documents | LIVE | Product tab and `management/knowledge/list` | Upload | `knowledge/get` | Approval state, retry, reprocess | Delete with retention | Delete and approve | Yes | file name, status, created, updated | File name | Status, file type, created range |
| Command Center | LIVE automation panel | Not a record grid | `runs/create` scan | Current automation status | `automation/pause` and `automation/resume` | Pause and resume. No delete | None | Not a grid | Not a grid | Not a grid | Status |
| AI Agents | LIVE | `management/agents/list` | `agents/create` | `agents/get` | `agents/update` | Pause, resume, archive. No delete | Pause and archive | Yes | name, status | Name and role | Status |
| Execution Inspector | LIVE | `management/runs/list` | `runs/create` test or scan | `runs/get` with steps and actions | Cancel, pause, resume, archive, replay | No hard delete of runs, steps, or actions | Cancel and archive | Yes | trigger, state, created | Trigger | State |
| Leads, campaigns, conversations, qualification, meetings, analytics | SIMULATED | None | None | None | None | None | None | Client only | Client only | Client only | Client only |
| Preferences, security center page, SSO, integrations, WhatsApp, webhooks | SIMULATED | None | None | None | None | None | None | Client only | Client only | Client only | Client only |

Password reset, sign-in, and email verification stay on the existing auth API. They are not management grids.

## Live modules

### Members

- Data source: LIVE.
- Tenant ownership: membership rows for the active organization. Removing a member does not delete the platform user.
- Permissions: list for any member of the organization; invite requires `users.invite`; role change requires `roles.manage` or `users.manage`; removal requires `users.manage`.
- Last owner cannot be removed. The batch result for that id is `CONFLICT`.
- UI: `/workspace/users`, `/add`, `/view`, `/edit`, plus the inline invite form and role select required by the existing browser test.
- Planned change that shipped: dedicated pages and a server grid. The old enterprise copy remains in `Enterprise.jsx` so the source check still sees its markers, and the users page no longer mounts that branch.

### Organizations

- Data source: LIVE.
- A signed-in user can create an organization. That call also switches the active organization and revokes navigation contexts.
- Update requires `organizations.manage` or the owner role, and the body id must be the active organization. A foreign id is `404`.
- Suspend and restore are status changes. There is no bulk organization delete.
- Settings still has the original create-organization form. "Manage organizations" opens the list.

### Roles

- Data source: LIVE, read-only.
- `management/roles/list` returns the built-in roles and their grants for the active organization.
- Custom role create, update, and delete are not implemented. Built-in roles cannot be edited. An edit navigation context for a role is rejected.

### Invitations

- Data source: LIVE.
- The list returns id, role, status (`PENDING`, `ACCEPTED`, `REVOKED`, `EXPIRED`), created time, and expiry. It does not return the email address.
- Lifecycle is resend through a new invitation, or revoke. Rows are not hard-deleted.

### Sessions

- Data source: LIVE.
- The caller sees and revokes only their own sessions.
- There is no add-session page and no hard delete.

### Audit

- Data source: LIVE, append-only.
- Search is a parameterized `contains` on action and entity type. Sort is `createdAt` with `id` as the tie-break.
- There is no update or delete endpoint.

### Products, versions, ICPs, and configuration

- Data source: LIVE.
- The Sprint 3 catalog remains so the existing product browser test still finds "Create product", the tabs, and the success toasts. Dedicated add, view, and edit pages sit beside it.
- Products are archived and restored. They are not hard-deleted.
- Published and other non-draft versions cannot be opened for edit (`409`). Publishing still uses the Sprint 3 immutability trigger.
- Positioning, pricing, objections, qualification questions, and sales restrictions are fields on the draft snapshot. Saving them increments the draft revision. Published snapshots are not edited in place.
- Organization defaults use optimistic concurrency via `expectedUpdatedAt`.

### Knowledge

- Data source: LIVE.
- Upload, processing, approval, retry, reprocess, and delete keep the Sprint 3 storage key, tombstone, and retention behavior.
- Readers do not see `DELETED` rows unless they have `products.write` and explicitly filter that status.
- Download stays on the existing authenticated file route. The document id is not placed in the browser URL.
- Bulk approve checks `approvals.manage` and approves each selected document on its own. A document the caller cannot approve is a per-record failure.

### Command Center, agents, and inspector

- Data source: LIVE for the signed-in automation panel, agent records, and run inspector. The prototype cards under the automation panel stay labeled as demo data.
- Add, view, and edit use the shared management layout and a session-bound navigation token. The address bar stays `/workspace/agents` or `/workspace/inspector` with `add`, `view`, or `edit`.
- Lists use server pagination, allowlisted sort, search, and status or state filters. Missing tokens, empty lists, and API errors render the shared states.
- Archive, pause, cancel, and bulk actions confirm first. There is no delete control. Database triggers reject `DELETE` on agent profiles, policies, runs, steps, actions, and model usage.
- A viewer can read. Creating, editing, and archiving require `agents.manage`. Pause and resume require `automation.pause`.
- Scan and test runs return the stored run state. The test path does not send a message. A paused organization does not call an external sender.
- Unsigned-in demo mode still renders the original agent and inspector prototypes.

## Simulated modules

These screens still render prototype data. Sprint 4 did not add production CRUD for them.

| Screen | Missing backend | Treatment |
| --- | --- | --- |
| Lead Discovery | No lead table API | Left simulated |
| Campaigns | No campaign table API | Left simulated |
| AI Conversations | No conversation store | Left simulated |
| Qualification | No live qualification queue | Left simulated |
| Meetings & Notes | No calendar provider | Left simulated |
| Approval Center | Product and knowledge approval are live on those screens. The center itself is still a prototype queue | Left simulated |
| Analytics | No warehouse | Left simulated |
| Preferences | Local prototype preferences | Left simulated |
| Security Center page | Account password reset is live on the auth screens. The center page is still a prototype | Left simulated |
| SSO & Authentication | No OIDC or SAML connection | Left simulated |
| Integrations, WhatsApp, Webhooks | No provider delivery | Left simulated |

## Shared UI

Live management pages use `apps/web/components/management/kit.jsx` and `apps/web/app/management.css`. The product catalog keeps its existing layout and adds the same confirmation, pagination, and selection behavior. Purple focus, sticky table headers, and the current sidebar are unchanged.
