# Screen to API mapping

**Status:** Design only. The UI is not wired to these routes in this run.  
**Date:** 4 November 2026  
**UI source of truth:** sidebar ids in `components/SalesOS.jsx` and auth views in `components/Enterprise.jsx`.  
**API source of truth:** BRD §13.2, extended for enterprise screens the partial `openapi.yaml` does not list. Generated OpenAPI from Nest must match this table before a screen leaves demo mode.

Conventions for every row:

- Paths are under `/api/v1`.
- Tenant routes include `{tenantId}` from the authenticated workspace, not from a free-typed header.
- The screen stays on `/` with the existing `page` id until a later routing pass. Deep links are optional and must not change layout.
- Demo repository behavior is the audit in `docs/REPOSITORY_AUDIT.md` §6. API mode replaces the outcome, not the control.

## 1. Auth gate

| UI control | Demo today | API mode | Phase |
|---|---|---|---|
| Sign in | Any email plus 8-character password | `POST /auth/login` | 2 |
| MFA | Any 6 characters | `POST /auth/mfa/verify` | 2 |
| Remember me | `localStorage` flag | Server session lifetime. Cookie only. | 2 |
| Forgot password | Generic local notice | `POST /auth/password/request-reset` | 2 |
| Reset password | Local compare | `POST /auth/password/confirm-reset` | 2 |
| SSO buttons | Jump to demo MFA | `GET /auth/oidc/{provider}/start` then callback. Disabled with an honest empty state until Phase 9. | 9 |
| Sign out | Clear flags | `POST /auth/logout` | 2 |
| Session restore | Storage flag | `GET /me` | 2 |

Acceptance: wrong password does not reveal whether the email exists beyond a uniform error. A remembered session survives refresh and dies when Security Center revokes it.

Tests: auth integration tests T2.1–T2.3; Playwright sign-in against the existing form in API mode.

## 2. Shell

| UI | API |
|---|---|
| Workspace name | `GET /me` memberships. Switcher calls `POST /session/tenant` with a membership the user actually has. |
| Sidebar badges | `GET /tenants/{tenantId}/approvals?status=PENDING` count and unread conversation count. |
| Capability-aware buttons | `GET /me` includes permission strings. |
| Global search | Phase 8: `GET /tenants/{tenantId}/search?q=`. Until then search continues to filter the loaded list only, and the placeholder stays honest. |

The three fake tenant names in the Settings dropdown are removed from code. Options come from memberships.

## 3. Command Center (`command`)

| Control | API | Notes |
|---|---|---|
| KPI tiles | `GET /tenants/{tenantId}/supervisor/briefing` and `GET /tenants/{tenantId}/analytics/summary` | Remove the `+ 44` qualified offset and the fixed `1,248` strings. |
| Pipeline funnel | `GET /tenants/{tenantId}/analytics/funnel` | |
| Pause / Resume Supervisor | `POST /tenants/{tenantId}/automation/pause` and `POST /tenants/{tenantId}/automation/resume` | Resume revalidates. Permission `automation.pause`. |
| Run AI cycle | `POST /tenants/{tenantId}/supervisor/scan` with `Idempotency-Key` | Returns 202 and a run id. The feed polls `GET /tenants/{tenantId}/agent-runs?limit=`. |
| Activity feed | `GET /tenants/{tenantId}/agent-runs` and audit highlights | |
| Handoffs | Pending `agent_actions` where state is `NEEDS_APPROVAL` | |
| Agent health | `GET /tenants/{tenantId}/agents` | Enabled flag is server state. |

Phase 4 for runs and pause. Phase 8 for real funnel numbers. Until Phase 8, briefing may return zeros with empty states rather than seed fiction in API mode.

Tests: scan creates one run; second scan with the same idempotency key does not duplicate; pause blocks a queued external action (AT-24).

## 4. AI Agents (`agents`)

| Control | API |
|---|---|
| List and select | `GET /tenants/{tenantId}/agents` |
| Enable switch | `PATCH /tenants/{tenantId}/agents/{agentKey}` `{ enabled }` |
| Test agent | `POST /tenants/{tenantId}/agents/{agentKey}/test` → 202 run with no external side effect |
| Tools and guardrails | Read-only projection of policy and configured connectors. Not editable free text that the model can treat as authority. |

`agentKey` stays the prototype ids: `supervisor`, `research`, `outreach`, `conversation`, `qualification`, `meeting`, `notes`, `followup`.

Phase 4. Tests: paused agent rejects test with 409; test run appears in the inspector; test run has zero rows in `messages` with direction `OUTBOUND`.

## 5. Execution Inspector (`inspector`)

| Control | API |
|---|---|
| Filters | `GET /tenants/{tenantId}/agent-runs?status=` |
| Step list | `GET /tenants/{tenantId}/agent-runs/{runId}` including `agent_run_steps` |
| Copy details | Client copy of the API payload. Payload is already redacted. |
| Replay | `POST /tenants/{tenantId}/agent-runs/{runId}/replay` creates a child run. Same idempotency rules. Does not resend if the parent action is `SENT`. |

Phase 4. Tests: cross-tenant run id returns 404; replay of a failed research run does not create a second outbound message.

## 6. Lead Discovery (`leads`)

Signed out, this page remains the simulated demonstration. Signed in, it renders `LeadsDesk`. Paths are `/workspace/leads`, `/workspace/leads/add`, `/workspace/leads/view`, and `/workspace/leads/edit`. The URL does not contain a database id. The tab stores a navigation token. Every route below is `POST /api/v1/management/...` with the id in the JSON body. The active organization comes from the session.

| Screen | Endpoint | Permission |
|---|---|---|
| Company list, get, create, update, archive | `accounts/list`, `accounts/get`, `accounts/create`, `accounts/update`, `accounts/archive` | `crm.accounts.read` or `crm.accounts.write` |
| Contact list, get, create, update | `contacts/list`, `contacts/get`, `contacts/create`, `contacts/update` | `crm.contacts.read` or `crm.contacts.write` |
| Lead list, get, create, update, stage, bulk stage | `leads/list`, `leads/get`, `leads/create`, `leads/update`, `leads/stage`, `leads/bulk-stage` | `crm.leads.read` or `crm.leads.write` |
| Summary counts | `leads/summary` | `crm.leads.read` |
| Assign owner | `leads/assign` | `crm.leads.assign` |
| Human takeover | `ownership/takeover` | `crm.leads.assign` |
| CSV template, preview, execute, errors, retry | `lead-imports/template`, `lead-imports/preview`, `lead-imports/execute`, `lead-imports/get`, `lead-imports/errors`, `lead-imports/retry` | `crm.leads.import` |
| Discovery providers, create, get, cancel, promote | `discovery/providers`, `discovery/create`, `discovery/get`, `discovery/cancel`, `discovery/promote` | `crm.leads.discover` |
| Qualification and human override | `qualification/run`, `qualification/override` | `crm.leads.qualify` |
| Eligibility | `eligibility/evaluate` | `crm.leads.read` |
| Suppression | `suppression/list`, `suppression/create`, `suppression/remove` | `crm.suppression.read` or `crm.suppression.manage` |
| Duplicate review and merge | `duplicates/list`, `duplicates/merge` | `crm.leads.read` or `crm.leads.merge` |
| Contact windows | `contact-policies/get`, `contact-policies/update` | `crm.leads.read` or `crm.contact_policy.manage` |

There is no campaign send endpoint. Meetings and WhatsApp stay simulated. Signed-in campaigns are section 7. The signed-in inbox is section 8.

## 7. Campaigns (`campaigns`)

Signed-out campaigns stay the simulated demonstration. Signed-in `/workspace/campaigns` uses `CampaignsDesk`. Identifiers are in the JSON body, not the path. Navigation tokens hide database ids. External delivery stays not authorized. Sent, delivered, replies, meetings, and conversions render as `NOT AVAILABLE`.

| Control | API | Permission |
|---|---|---|
| List and open | `POST /api/v1/management/campaigns/list`, `campaigns/get` | `campaigns.read` |
| Add and clone | `campaigns/create`, `campaigns/clone` | `campaigns.create` |
| Edit and transition | `campaigns/update`, `campaigns/transition` | `campaigns.edit` |
| Archive | `campaigns/archive` | `campaigns.archive` |
| Segments | `segments/list`, `segments/get`, `segments/preview` | `campaigns.read` |
| Save a segment | `segments/create`, `segments/update`, `segments/clone`, `segments/materialize` | `campaigns.audience.manage` |
| Assign an audience | `campaign-audiences/assign` | `campaigns.audience.manage` |
| Sequences | `sequences/list`, `sequences/get` | `campaigns.read` |
| Save and publish a sequence | `sequences/create`, `sequences/steps`, `sequences/freeze`, `sequences/assign` | `campaigns.sequence.manage` |
| Templates | `campaign-templates/list`, `campaign-templates/get`, `campaign-templates/create` | `campaigns.read` or `campaigns.template.manage` |
| Request review | `campaign-approvals/request` | `campaigns.edit` |
| Decide review | `campaign-approvals/decide` | `campaigns.review` |
| Personalize, start, advance | `campaign-simulation/personalize`, `campaign-simulation/start`, `campaign-simulation/advance` | `campaigns.simulate` |
| Execution monitor | `campaign-simulation/monitor` | `campaigns.read` |
| Analytics | `campaign-analytics/summary` | `campaigns.analytics.read` |

## 8. AI Inbox (`inbox`)

Signed-out inbox stays the simulated demonstration. Signed-in `/workspace/inbox` uses `InboxDesk` and these body endpoints. Identifiers are in the JSON body, not the path.

| Control | API | Permission |
|---|---|---|
| Provider status | `POST /api/v1/management/mailboxes/providers` | `mailbox.read` |
| List and open a mailbox | `mailboxes/list`, `mailboxes/get` | `mailbox.read` |
| Add a capture mailbox | `mailboxes/capture` | `mailbox.connect` |
| Start OAuth | `mailboxes/oauth/start` | `mailbox.connect` |
| Disconnect | `mailboxes/disconnect` | `mailbox.connect` |
| Import and sync | `mailbox-sync/import`, `mailbox-sync/run` | `mailbox.connect` |
| Thread list and detail | `threads/list`, `threads/get` | `mailbox.read` |
| Link and assign | `threads/link`, `threads/assign` | `mailbox.draft` |
| Drafts | `drafts/list`, `drafts/save`, `drafts/submit` | `mailbox.read` or `mailbox.draft` |
| Decision | `email-approvals/decide` | `mailbox.review` |
| Send review | `email-send/run` | `mailbox.send` plus `mailbox.send.execute` on the server |
| Sending status | `email-sending/status` | `mailbox.read` |
| Tenant send policy | `email-sending/policy` | `mailbox.send.manage` |
| Mailbox sending switch | `email-sending/mailbox` | `mailbox.send.manage` |
| Send-scope consent | `mailboxes/oauth/send-start` | `mailbox.send.request` |
| Delivery | `delivery/list`, `delivery/reconcile` | `mailbox.read` |
| Analysis run | `inbox-ai/run` | `mailbox.draft` |
| Operations overview | `operations/overview` | `mailbox.operations.read` |
| Operations mailboxes, runs, errors | `operations/connections`, `operations/get`, `operations/runs`, `operations/errors` | `mailbox.operations.read` |
| Operational alerts | `operations/alerts` | `mailbox.health.read` |
| Acknowledge an alert | `operations/alerts/acknowledge` | `mailbox.operations.manage` |
| Pause or resume sync | `operations/pause` | `mailbox.operations.manage` |
| Recover an expired cursor | `operations/recover-cursor` | `mailbox.sync.recover` |

OAuth return is `GET /api/v1/mailbox/oauth/callback`. Capture webhooks are `POST /api/v1/mailbox/webhooks/capture`. The Inbox screen shows `SEND DISABLED`, `NOT CONFIGURED`, `READ ONLY`, and `MOCK / CAPTURE MODE`. It does not show `SEND NOW` while `email-sending/status` reports `sendNow: false`. A capture result is not labeled delivered. Read-only OAuth and send-scope OAuth are separate requests. Live send stays off unless the deployment flag, the tenant policy, and the mailbox switch are all on, and a person still has to call `email-send/run`.

## 9. Qualification (`qualification`)

| Control | API |
|---|---|
| List and score | `GET /tenants/{tenantId}/leads?view=qualification` |
| Factor breakdown | `score_reasons` from the scoring policy, each with a source id |
| Mark qualified | `POST /leads/{id}/qualify`. Server refuses `SALES_READY` when required schema fields or explicit next-step interest are absent (FR-046). |
| Request meeting | Same propose endpoint as inbox |

The `+24/+23/+20/+10/+10` block is deleted in API mode. If reasons are empty, the panel shows an empty state.

Phase 5 scoring, Phase 7 sales-ready rule. Tests: deterministic re-score; missing budget cannot be invented; two products with different schemas both pass (AT-18).

## 10. Meetings (`meetings`)

| Control | API |
|---|---|
| List | `GET /tenants/{tenantId}/meetings` |
| Create | `POST /tenants/{tenantId}/meetings` as a proposed hold, or book via `POST /meetings/book` |
| Agenda and attendees | Meeting resource |
| Transcript tab | `GET /meetings/{id}/artifacts`. Empty state remains when status is `NO_TRANSCRIPT`. |
| AI Notes | `GET /meetings/{id}/notes`. Generate via `POST /meetings/{id}/summarize` only when an authorized artifact exists. |
| Action items | `GET/POST /tenants/{tenantId}/tasks` and `POST /meeting-actions/{id}/confirm` |
| Checkbox | `PATCH /tasks/{id}` `{ status }` persisted |
| Prepare follow-up | Creates an `outreach_draft` in approval. It does not send. |

Phase 7 booking, Phase 8 notes. Tests: AT-11 one calendar id; AT-12 provider rejection does not show booked; AT-21 no invented notes; task checkbox still checked after reload.

## 11. Approval Center (`approvals`)

| Control | API |
|---|---|
| Queue | `GET /tenants/{tenantId}/agent-actions?state=NEEDS_APPROVAL` and drafts |
| Approve | `POST /agent-actions/{id}/approve` or `POST /drafts/{id}/approve` with `If-Match` |
| Reject | `POST .../reject` with a reason |

Approve does not send. Send remains a separate call that rechecks suppression. The button label can stay "Approve" and the toast must say the action is approved, not delivered.

Phase 4 for the action queue, Phase 6 for mail drafts. Tests: stale version 409; edited draft clears approval; approver without `approvals.review` receives 403.

## 12. Analytics (`analytics`)

| Control | API |
|---|---|
| Period | `GET /tenants/{tenantId}/analytics/summary?from=&to=` |
| Agent outcomes | `GET /tenants/{tenantId}/analytics/agents` from `agent_runs` and `llm_usage` |
| Campaign mix | Counts from campaigns and leads |

## 7A. WhatsApp (`whatsapp`)

Signed-in `/workspace/whatsapp` uses `WhatsAppDesk`. The page says `LIVE WHATSAPP SENDING DISABLED`. There is no Send control. Database ids stay out of the URL. Navigation tokens open a conversation.

| Control | API |
|---|---|
| Overview | `POST /api/v1/management/whatsapp/overview` |
| Connections | `POST /api/v1/management/whatsapp/connections/list`, `/create`, `/update`, `/disable`, `/rotate` |
| Phones | `POST /api/v1/management/whatsapp/phones/list`, `/create` |
| Conversations | `POST /api/v1/management/whatsapp/conversations/list`, `/get`, `/assign`, `/link` |
| Drafts | `POST /api/v1/management/whatsapp/drafts/prepare`, `/decide` |
| Templates | `POST /api/v1/management/whatsapp/templates/list`, `/create`, `/version` |
| Alerts and events | `POST /api/v1/management/whatsapp/alerts/list`, `/acknowledge`, `events/list`, `events/process` |
| Webhook | `GET` and `POST /api/v1/webhooks/whatsapp` |

`GET` returns the challenge as plain text. `POST` requires `X-Hub-Signature-256`. Neither management route sends a message. Counts on the overview come from tenant rows. Provider-approved templates and real provider statuses are zero until an authentic provider status exists. The live labels stay `LIVE META — NOT CONFIGURED`, `REAL WEBHOOK — NOT TESTED`, and `LIVE WHATSAPP SEND — NOT AUTHORIZED`.
| Warnings | Briefing provider failures and paused campaigns |

Phase 8. Until aggregates exist, API mode renders empty charts, not the fixed 12-bar array. Tests: period query changes the window; tenant isolation on the aggregate queries.

## 13. Products (`products`)

| Control | API |
|---|---|
| Cards | `GET /tenants/{tenantId}/products` |
| Add offering | `POST /tenants/{tenantId}/products` |
| Knowledge base | `GET/POST /tenants/{tenantId}/products/{id}/knowledge` |
| Create campaign | Existing campaign modal, product id from the card |

Phase 3. Tests: unpublished facts absent from a draft prompt fixture (ST-002); revoked document blocks new drafts (FR-014).

## 14. Preferences (`preferences`)

`GET/PUT /tenants/{tenantId}/me/preferences`.

Preview uses the saved IANA zone and locale. Theme may stay light if the CSS is not switched; the API still stores the choice. Currency from this resource feeds the pipeline formatter.

Phase 2. Tests: reload shows saved timezone; another user in the same tenant does not see this user's signature.

## 15. Security Center (`security`)

| Control | API |
|---|---|
| Policy toggles and numbers | `GET/PATCH /tenants/{tenantId}/security` |
| Sessions | `GET /tenants/{tenantId}/sessions` |
| Revoke | `POST /sessions/{id}/revoke` |
| Sign out others | `POST /sessions/revoke-others` |

Phase 2. MFA-required is enforced on the next privileged login, not only stored. Tests: revoked session cookie receives 401; idle timeout is server-side.

## 16. SSO (`sso`)

| Control | API | Phase |
|---|---|---|
| List and edit drafts | `GET/POST/PATCH /tenants/{tenantId}/identity-providers` | 9 |
| Test | `POST /identity-providers/{id}/test` | 9 |
| Disable | `PATCH` status `DISABLED` | 9 |

Until Phase 9 the screen loads and shows an empty verified list. It must not offer "Preview SSO continuation" into a logged-in shell.

Tests: draft cannot authenticate; verified OIDC checks state, nonce, and PKCE; raw client secret is not in the GET body.

## 17. Users and roles (`users`)

| Control | API |
|---|---|
| List | `GET /tenants/{tenantId}/members` |
| Invite | `POST /members/invite` sends mail through the transaction notification path when email is configured; otherwise 422 `MAIL_NOT_CONFIGURED`, not a fake success |
| Role | `PATCH /members/{userId}` |
| Suspend | same, status `SUSPENDED` |
| Permission matrix | `GET/PUT /roles/{roleId}/permissions` |
| New role | `POST /roles` with an empty grant set |

Phase 2. Tests: Sales cannot `PUT` permissions; suspended member loses access immediately; invitation audit row is server-generated.

## 18. Integrations (`integrations`)

| Control | API |
|---|---|
| Catalog | `GET /integration-manifests` (no secrets) |
| Save | `PUT /tenants/{tenantId}/integrations/{provider}` secrets in a write-only body |
| Test | `POST /integrations/{id}/test` → 202 |
| Remove | `DELETE` scrubs ciphertext |
| Rotate | `POST /integrations/{id}/rotate-secret` |

Status stays `UNVERIFIED` until the worker test succeeds. The nine prototype manifests are the catalog. Phase 6 implements mail and calendar tests. Other providers return a clear "adapter not enabled" from the test endpoint. Phase 9 enables WhatsApp, CRM, and custom webhook auth.

Tests: GET never contains the token; advanced properties that use secret key names are 422; test does not run in the browser.

## 19. Webhooks (`webhooks`)

| Control | API | Phase |
|---|---|---|
| List, add, delete, enable | `GET/POST/PATCH/DELETE /tenants/{tenantId}/webhook-endpoints` | 9 |
| Test | `POST /webhook-endpoints/{id}/deliveries/test` | 9 |

HTTPS only, stored secret, signed body, allowlist or public-address check. Phase 6 still accepts provider inbound webhooks at `POST /integrations/email/{connectorId}/webhook`, which is not this screen. That inbound route is signature-verified and has no session cookie.

Tests: http URL rejected; test delivery recorded; private IP URL rejected; replayed inbound provider event deduped.

## 20. WhatsApp (`whatsapp`)

| Control | API | Phase |
|---|---|---|
| Account and policy | `GET/PUT /tenants/{tenantId}/channels/whatsapp` | 9 |
| Bot test bench | `POST /channels/whatsapp/agent/test` runs the same policy and LLM port against a sandbox conversation flag. No Meta send. | 9 |
| Inbox | Channel filter on conversations | 9 |
| Templates | `GET/POST /channels/whatsapp/templates` status `DRAFT` until Meta returns approved | 9 |
| Opt-ins | Suppression and consent rows, not a local toggle that can opt a person back in without a source event | 9 |
| Insights | Analytics filter `channel=WHATSAPP` | 9 |

The keyword script in `Enterprise.jsx` is demo-only. API mode removes it.

Tests: opted-out number cannot be sent a business-initiated message; template in `DRAFT` cannot be used outside the customer-care window; test bench writes no provider message id.

## 21. Audit (`audit`)

| Control | API |
|---|---|
| Filter | `GET /tenants/{tenantId}/audit?q=&cursor=` |
| Export CSV | `POST /tenants/{tenantId}/audit/exports` as a job. File contains only that tenant. Permission `audit.read` plus export permission for the full dump. |

Phase 2 writes the events. Phase 9 streams the export if the row count is large. The client does not assemble compliance CSV from React state in API mode.

Tests: user cannot edit an audit row through the API; export excludes tenant B; secret fields absent from payloads.

## 22. AI and workspace settings (`settings`)

| Control | API |
|---|---|
| Active workspace | Same as shell switcher |
| Model preference | `PATCH /tenants/{tenantId}/settings` `{ llmProvider, model }`. Unknown provider 422. `CONNECTED` only after an integration test. |
| Supervisor / outbound / transcripts toggles | Map to `automation_policies` and tenant settings. "Autonomous outbound" cannot exceed the campaign approval mode. |
| Integration rows on this screen | Deep-link to the Integrations screen. Remove the duplicate "Configure" toast. |
| Reset demonstration | Shown only in demo mode. API mode replaces it with no control, or with an admin-only sandbox reset that is not the production database. |

Phase 2 for settings persistence, Phase 4 for policy toggles. Tests: selecting "OpenAI adapter" without credentials leaves status disconnected; enabling transcripts does not create notes without an artifact.

## 24. Meetings and calendar (`meetings`)

Signed-in route: `/workspace/meetings`. Component: `CalendarDesk`. Identifiers stay in POST bodies. Navigation tokens are `calendar_connection`, `calendar_meeting`, and `calendar_meeting_type`.

| Control | API |
|---|---|
| Overview and the five not-authorized labels | `POST /api/v1/management/calendar/overview` |
| Connections | `POST /api/v1/management/calendar/connections/list` and `connections/create` |
| OAuth start and callback | `connections/oauth/start`, `connections/oauth/callback`. No code is exchanged in Sprint 11. |
| Working hours and blocked dates | `rules/save`, `rules/block` |
| Meeting types | `meeting-types/list`, `meeting-types/create` |
| Local slots | `availability` with `mode: LOCAL_ONLY` |
| Hold and conflict | `slot-holds/create` |
| Internal booking, approval, confirm, reschedule, cancel | `booking-requests/create`, `meetings/submit`, `approvals/decide`, `meetings/confirm`, `meetings/reschedule`, `meetings/cancel` |
| Notes, outcomes, tasks, proposals, analytics, operations | `notes/create`, `outcomes/record`, `tasks/create`, `proposals/create`, `analytics`, `operations` |

There is no external write route and no public booking link. External confirmations, invitation delivery, attendee acceptance, and provider joins render `NOT AVAILABLE` or `NOT AUTHORIZED`.

## 23. Screen exit rule

A screen leaves demo mode when:

1. Its table in this document has a passing API test and a Playwright test on the existing controls.
2. Empty, error, and forbidden states use the current panel styles.
3. No success toast claims an external effect the provider did not acknowledge.
4. The SIMULATED badge is removed for that screen only.

Other screens may remain on the demo repository in the same shell during the transition. Production deployment sets `DATA_SOURCE=api` for every screen that has exited, and does not ship a half-connected Send button.
