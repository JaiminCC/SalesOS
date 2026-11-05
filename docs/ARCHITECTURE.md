# SalesOS target architecture

**Status:** Design only. No services were scaffolded in this run.  
**Date:** 4 November 2026  
**Baseline:** Enterprise prototype v2.1 (see `docs/REPOSITORY_AUDIT.md`) and the BRD/SRS in `sales-os-docs/Code_Colonies_SalesOS_Developer_Package/`.  
**Decision carried forward:** ADR-001 modular monolith. One Next.js app, one NestJS API, one BullMQ worker. Not microservices.

The UI stays. Screens keep their current layout, copy, and navigation ids. Each screen gains a data adapter. Demo mode remains available until that screen's API acceptance tests pass. Production mode never reports a send, booking, or connection unless the provider acknowledgement is stored.

## 1. System context

```text
Browser (existing SalesOS UI)
        │  HTTPS, session cookie, CSRF
        ▼
apps/web (Next.js) ── server-side BFF optional later; MVP calls apps/api directly
        │
        ▼
apps/api (NestJS) ── auth, RBAC, validation, policy, transactional outbox
        │
        ├── PostgreSQL 16  (system of record, RLS)
        ├── object storage (knowledge files, transcripts)
        └── Redis 7 ── BullMQ
                         │
                         ▼
                    apps/worker
                         ├── supervisor loop
                         ├── research / scoring
                         ├── drafting / inbound
                         ├── outbound email
                         ├── calendar booking
                         ├── meeting notes
                         └── webhooks / retention

External systems, only through packages/integrations:
  mailbox, calendar, licensed research source, LLM provider, later WhatsApp Cloud API
```

Workers do not trust the model. A model returns a typed proposal. `PolicyService` decides. A typed executor performs the side effect. Provider success is a separate state from "the model wanted this".

## 2. Monorepo

npm workspaces, TypeScript strict, Node 22. The current prototype moves to `apps/web` without a visual rewrite. Package names below are the ones requested for this program. The BRD names map as follows.

| Requested package | Absorbs BRD packages | Responsibility |
|---|---|---|
| `apps/web` | `packages/ui` stays inside the app until a later extraction | Existing Next.js UI. |
| `apps/api` | Nest modules from BRD §11.1 | HTTP, auth, transactions, outbox write. |
| `apps/worker` | Queue processors | Job execution. No second copy of business rules. |
| `packages/database` | `db/migrations` | Prisma schema, SQL migrations, RLS, generated client. |
| `packages/shared` | `packages/contracts`, `packages/policy` | Zod/DTO, events, state machines, pure policy. |
| `packages/agent-core` | `packages/ai` | LLM port, prompt versions, output schemas, run state machine. |
| `packages/integrations` | `packages/connectors` | Mail, calendar, research, meetings, WhatsApp, webhook signing. |

```text
salesos/
  apps/web/
  apps/api/
  apps/worker/
  packages/database/
  packages/shared/
  packages/agent-core/
  packages/integrations/
  infra/                  # compose, Caddy, backup scripts
  docs/
```

Rules:

- `packages/shared` has no Nest, Prisma, Redis, or network imports.
- `packages/agent-core` depends on `packages/shared` only. It does not import a vendor SDK.
- `packages/integrations` implements ports. Vendor SDKs stay inside this package.
- `apps/api` and `apps/worker` both depend on database, shared, agent-core, and integrations. They do not import each other.
- Product names, ICP text, and tenant names never appear in `if` conditions. They appear in database rows and fixtures.

## 3. Request path

1. Browser sends the session cookie to `apps/api`.
2. Auth guard loads the session, rejects revoked or expired sessions, and attaches `userId`.
3. Tenant guard loads membership for the `{tenantId}` in the path. Missing membership is 404. A resource that exists in another tenant is also 404 (no existence leak).
4. RBAC guard checks a permission string (`outreach.approve`, `automation.pause`).
5. The handler opens a transaction, runs `SELECT set_config('app.tenant_id', $tenantId, true)`, and uses the Prisma client bound to that transaction.
6. Mutations that must cause work write the business row and an `outbox_events` row in the same transaction.
7. A relay publishes outbox rows to BullMQ. The worker loads the row again under RLS. It does not trust the Redis payload for authorization or PII.

`set_config(..., true)` is transaction-local. Session-level `SET` is forbidden because Prisma and BullMQ reuse connections. A test must fail if a second transaction on the same pooled connection can still see the previous tenant.

The runtime database role is not the migration owner, is not a superuser, and does not have `BYPASSRLS`. Tables that hold tenant data use `ENABLE` and `FORCE ROW LEVEL SECURITY`.

## 4. Authentication and RBAC

### 4.1 Sessions

- Password hashing: Argon2id (or scrypt if Argon2 cannot ship in the first container). Never store the prototype's "any 8 characters" rule.
- Login, refresh, and logout rotate the session id.
- Cookie: `HttpOnly`, `Secure`, `SameSite=Lax` (or `Strict` if the web origin matches the API). No access token in `localStorage`.
- CSRF: double-submit or a synchronizer token on cookie-authenticated mutations.
- Admin, Owner, and anyone with `connectors.manage` or `automation.pause` must pass TOTP before those permissions apply.
- Remember-me is a refresh session with a server-side absolute lifetime, revocable from Security Center.
- Password reset emails are identical whether the account exists. Tokens are single-use and hashed at rest.
- SSO (OIDC first, SAML after the email MVP) is Phase 9. Phase 2 still ships the SSO screen as "not configured" rather than the current fake continuation.

### 4.2 Roles

The prototype shows Owner, Admin, Manager, Sales, Analyst. The BRD adds Reviewer and Platform operator. Keep the prototype labels and enforce permissions.

| UI role | BRD counterpart | Default posture |
|---|---|---|
| Owner | Tenant admin | All tenant permissions, including pause, export, and connectors. |
| Admin | Tenant admin minus billing (none in MVP) | Users, connectors, policies, audit. Not required for day-to-day sending. |
| Manager | Campaign manager / CCO | Campaigns, approvals, assignments, briefing. |
| Sales | Sales rep | Assigned leads, conversations, drafts. Send only when an approval exists or policy says the action is pre-approved. |
| Analyst | Viewer | Read analytics and records. No send, no connector secrets. |
| Reviewer | Reviewer | Approvals and read scoped to the queue. Custom role the Users screen can already draft. |
| Platform operator | Platform operator | Health and operational logs. No default read of tenant content. Break-glass is out of MVP UI. |

Permission catalog (enforced in the API, rendered by the existing matrix):

`leads.read`, `leads.write`, `campaigns.manage`, `outreach.send_approved`, `approvals.review`, `agents.configure`, `connectors.manage`, `users.manage`, `audit.read`, `tenant.export`, `products.write`, `products.publish`, `automation.pause`, `meetings.book`.

Record-level checks sit on top of RBAC: a Sales user reads leads they own or that are on campaigns they are assigned. RLS isolates tenants. It does not replace assignment checks.

## 5. AI runtime

### 5.1 LLM port

Design contract, not implemented code. `packages/agent-core` exports a port. `packages/integrations` supplies adapters (OpenAI-compatible HTTP, Anthropic, Ollama). Tests use an in-memory fake.

```text
LlmProvider.generateStructured({
  tenantId, task, promptVersion, messages,
  outputSchema, timeoutMs, maxTokens
}) -> { result, usage, model, latencyMs, traceId }
```

The port returns schema-valid JSON or a typed failure. It does not send email, write SQL, or choose a tenant. Vendor SDK types do not leak into `apps/api`.

Every call records provider, model, prompt version, token usage, latency, and a redacted input reference on `agent_runs`. Prompts and message bodies are not logged at info level.

A monthly tenant budget and a per-campaign cap live in configuration. Crossing the cap stops new model jobs and leaves human workflows usable (NFR-14, AT-13).

### 5.2 Supervisor

The supervisor is a durable worker, not the "Run AI cycle" button. The button becomes "enqueue a scan".

Loop:

1. Wake on outbox events and on a per-tenant schedule.
2. Load due facts: new inbound mail, pending approvals, stale leads, meetings awaiting notes, failed jobs.
3. Ask the model for one of: `RESEARCH_ACCOUNT`, `DRAFT_MESSAGE`, `QUALIFY_REPLY`, `PROPOSE_MEETING`, `SUMMARIZE_MEETING`, `CREATE_TASK`, `ESCALATE`, `NO_ACTION`.
4. Persist the proposal as `agent_actions` in `PROPOSED`.
5. Run `PolicyService`. The model's `requiresApproval` flag is ignored as authority.
6. Execute only `READY` actions. `NEEDS_APPROVAL` waits for the Approval Center. `BLOCKED` is terminal for that attempt.

Priority, unchanged from BRD §28.1:

1. P0 — opt-out and human takeover. Cancel queued sends first.
2. P1 — interested replies, booking confirmation, provider errors.
3. P2 — stale leads, overdue tasks, upcoming meetings.
4. P3 — research and drafting, while budget remains.

### 5.3 Run lifecycle

`agent_runs.state`:

`QUEUED → RUNNING → SUCCEEDED`  
also `PAUSED`, `WAITING_APPROVAL`, `FAILED_RETRYABLE`, `FAILED_FINAL`, `CANCELLED`.

`agent_actions.state`:

`PROPOSED → POLICY_CHECKED → BLOCKED | NEEDS_APPROVAL | READY → RUNNING → SUCCEEDED`  
also `FAILED_RETRYABLE`, `FAILED_FINAL`, `CANCELLED`, `EXPIRED`.

Pause:

- Tenant kill switch is a row, not a cache flag. External writes read it inside the same transaction as the side effect.
- Pausing a single agent marks its queued actions `PAUSED` and removes or delays the BullMQ job.
- Resume re-enqueues the same idempotency key and runs policy again (AT-24). It does not "continue the HTTP call" that was in flight.

Retries:

- BullMQ attempts with exponential backoff and jitter (3 to 5, matching BRD §10.5).
- The database row is the source of truth. Redis delivery is at-least-once.
- Idempotency key is `(tenant_id, key)` for API mutations and `(tenant_id, provider, provider_event_id)` for webhooks.
- Uncertain provider acceptance is reconciled by provider id. The worker must not send a second copy because the first response timed out (AT-07).
- Terminal failures land on a dead-letter queue with the run id. Operators replay from the Inspector, which creates a new attempt linked to the parent run.

### 5.4 Policy

`packages/shared` exports a pure function:

```text
decide(action, context) ->
  ALLOW | REQUIRE_APPROVAL | BLOCK
  plus reason codes
```

Context includes autonomy level (A0–A4), channel, action type, campaign approval mode, suppression, `human_owned`, kill switch, budget, quiet hours, and whether the draft version still matches the approved version.

MVP defaults:

- A4 / `FIRST_CONTACT_REQUIRED`: first outbound always `REQUIRE_APPROVAL`.
- Opt-out, hard bounce, complaint: `BLOCK`.
- Human takeover: `BLOCK` automatic sends on that conversation until a manager releases it.
- Pricing guarantees, legal assurances, discounts, and contract language: `BLOCK` or `REQUIRE_APPROVAL`, never `ALLOW`, even if the model says otherwise (AT-08).
- Global pause: `BLOCK` external writes. Reads and internal alerts may continue.

Policy version is stored on the action. Changing a policy does not rewrite history.

### 5.5 Untrusted text

Web pages, inbound email, and transcripts are data. The prompt contract in BRD §15.3 is the system instruction. Tool execution goes through named executors. A transcript that says "export the CRM" becomes text in a segment, not a tool call (AT-03, AT-23).

## 6. Integrations

Ports in `packages/integrations`:

| Port | MVP behavior |
|---|---|
| `Mailbox` | Send, fetch, parse threads. OAuth or SMTP/IMAP from encrypted credentials. |
| `Calendar` | Free/busy and create event. Booking stored only with `provider_event_id`. |
| `ResearchSource` | One authorized adapter plus CSV import. No LinkedIn automation. |
| `MeetingArtifact` | Upload or provider export of a consented transcript. |
| `LlmProvider` | Behind the agent-core port. |
| `WhatsApp` | Phase 9. Official Cloud API, opt-in, templates. Interface exists earlier and returns `NOT_CONFIGURED`. |
| `Crm` | Phase 9 optional sync. Internal pipeline is the MVP CRM. |
| `WebhookSigner` | HMAC-SHA256, timestamp, delivery id. |

Credentials:

- AES-256-GCM, versioned key id, unique IV.
- Envelope: tenant data key wrapped by a process key from the secret store. Keys are not in Postgres or Git.
- Lookup of contacts uses HMAC of the normalized email, not a reversible column.
- API responses return `configured: true` and a last-four hint where useful. They never return the secret.
- Test connection runs on the worker, stores a status, and writes an audit event. The browser test button does not open a socket.

Outbound HTTP from the research and webhook workers blocks link-local, loopback, and private ranges after DNS resolution, and re-checks the address before connect (SSRF control, BRD §16.4).

## 7. Web application

`apps/web` is the current Next.js 15 App Router tree after the move.

- Keep `SalesOS` and `Enterprise` structure and CSS.
- Add a repository interface per screen: `DemoSalesRepository` (today's seeds and reducers) and `ApiSalesRepository`.
- `NEXT_PUBLIC_DATA_SOURCE=demo|api`. Default in production is `api`. Default in local prototype mode is `demo` until Phase 2 flips sign-in.
- The shell reads capabilities from `GET /me` and hides actions the role cannot perform. Hiding is not the control. The API is the control.
- Loading, empty, and error states wrap existing panels. Do not invent a second visual language.
- "SIMULATED" badge remains while the screen's repository is demo. It comes off only when provider-backed states are real.
- Success toasts for send and book use server status: `Queued`, `Sent` (provider id present), `Booked` (calendar id present). The UI must not map HTTP 202 "accepted by our API" to "delivered".

No screen is deleted. Mobile Figma boards stay a later layout pass on the same components.

## 8. API shape

Base path `/api/v1`. JSON envelope `{ data, meta: { requestId } }` and `{ error: { code, message, details }, meta: { requestId } }`.

Conventions from BRD §13:

- Cursor pagination.
- Unknown JSON fields rejected.
- `Idempotency-Key` on creates and external side effects.
- `If-Match` version on approvals and other compare-and-swap transitions.
- Timestamps UTC.
- Health: `GET /health/live`, `GET /health/ready` (ready checks Postgres and Redis).

Route inventory for screens is in `docs/SCREEN_API_MAPPING.md`. The partial `openapi.yaml` is the seed. Nest Swagger must become the generated contract so the YAML cannot drift.

## 9. Worker topology

Queues: `research`, `scoring`, `drafting`, `outbound`, `inbound`, `qualification`, `scheduling`, `meetings`, `notifications`, `webhooks`, `retention`, `supervisor`, `dead-letter`.

Each job payload is `{ tenantId, outboxId, idempotencyKey, correlationId }`. The worker re-reads the outbox and domain rows. Per-tenant concurrency limits come from tenant settings. A paused tenant's external queues do not start new side effects; in-flight jobs hit the kill-switch check and exit as `CANCELLED` or `PAUSED`.

Sprint 3 adds `knowledge.process` on the existing foundation queue. The payload is `{ tenantId, documentId, outboxId }` for event `knowledge.document.process.v1`. The worker reads private object storage, extracts and chunks text, and writes embeddings only when the configured provider matches the tenant embedding index. A document failure is stored as `FAILED` and does not throw out of the job. The same relay calls `list_due_knowledge_deletions` and removes retained bytes that are past `retain_until`. Playwright and the API integration suite set `SALESOS_PROCESS_KNOWLEDGE=inline` so they do not depend on a second worker process.

## 10. Observability

Structured logs with `traceId`, `tenantId`, `jobId`. No message bodies, transcripts, or secrets.

Metrics: queue lag, retries, dead letters, policy blocks, opt-outs, model tokens and cost, booking failures, RLS denials, backup age.

Alerts follow BRD §18: queue delay over 5 minutes, credential refresh failure, bounce spike, error-rate spike, 80% model budget, backup failure.

Pilot SLOs (NFR-03, NFR-04, NFR-05): 99% monthly API availability excluding agreed maintenance; p95 dashboard reads under 800 ms excluding LLM time; enqueue under 1 second at pilot load; 95% of healthy-provider inbound events classified within 2 minutes.

## 11. Deployment

Development Compose (to be created in Phase 1, replacing the reference file that points at missing Dockerfiles):

- `pgvector/pgvector:pg16` with a health check, private network, password from env. The image pin includes the `vector` extension. Local volumes are kept when the image is recreated. Do not delete `infra_salesos_postgres`.
- `redis:7` with AOF and a password, private network.
- `api`, `worker`, `web` built from the monorepo.
- Postgres and Redis ports are not published on a shared or production host. Local laptops may publish them only on `127.0.0.1`.

Production sketch, unchanged from BRD §19: Internet → Caddy TLS → web and API on an edge network → Postgres, Redis, and worker on an internal network. Secrets from files, not image layers. Daily encrypted backup, tested restore. Sizing hypothesis remains 4 vCPU / 8 GB for an externally hosted model, and more if Ollama runs on the same box. That hypothesis is not a capacity guarantee.

## 12. What stays out of the MVP

From BRD §4.3, still excluded: LinkedIn scraping or automated DMs, contract signing, voice bots, deepfakes, payment collection, ad optimization, silent meeting bots, SOC 2 certification, HA multi-region, and subscription billing.

WhatsApp, OIDC, SAML, CRM sync, and webhook delivery are Phase 9. Their tables and ports are designed now so Phase 2 does not paint the schema into a corner. Their external side effects stay disabled until that phase's tests pass.

## 13. Architecture acceptance

This document is accepted when:

- An engineer can place a new feature in exactly one app or package using the dependency rules in §2.
- Tenant context, policy, and provider acknowledgement are visible as separate steps, and none of them is "the UI said success".
- The eight prototype agents map onto supervisor tasks without a new service per agent.
- Demo mode and API mode are both defined, and production defaults to API mode.

## 14. Product intelligence (Sprint 3)

Products, versions, ICPs, positioning, pricing, and knowledge are tenant rows. The browser never supplies the organization id used for writes. `products.read` and `products.write` cover the catalog and drafts. `approvals.manage` approves or rejects versions and documents. `products.publish` publishes an approved version. A user who can edit a draft does not receive publish rights from that edit permission.

Published snapshots are immutable. A database trigger rejects snapshot edits except while both the old and new status are `DRAFT`, and except the single `knowledgeDocumentIds` change on `APPROVED` → `PUBLISHED`. Publishing takes a transaction advisory lock, supersedes the current published version, and freezes the approved document ids.

Knowledge bytes live under `SALESOS_STORAGE_ROOT` (default `data/objects`, gitignored), never in `apps/web/public`. API responses omit `storageKey` and filesystem paths. Retrieval for live agent context uses only the published version and documents that are still `APPROVED`. Keyword results are labeled `keyword`. Semantic results require the pinned 384-dimension model. The HTTP embedding provider is refused when `NODE_ENV=test` or `CI=true`.

The reusable context service is `POST /api/v1/products/:id/context/preview`. It is not an LLM agent. Campaigns, inbox, and WhatsApp stay simulated. Signed-in Command Center automation is covered in section 16.

## 15. Management screens and secure navigation (Sprint 3.1)

Live management screens share one interaction pattern: a list with server pagination, an allowlisted sort, search, and module filters, then dedicated add, view, and edit pages. Browser paths are `/workspace/{module}`, `/workspace/{module}/add`, `/workspace/{module}/view`, and `/workspace/{module}/edit`. Those paths do not carry database primary keys.

The selected record is an opaque navigation context. `POST /api/v1/navigation/contexts` checks the session, the active organization, resource ownership, and the permission for that action, then stores a random token hash on `navigation_contexts`. The browser keeps the token in `sessionStorage` for that tab only. Refresh calls `POST /api/v1/navigation/contexts/resolve`, and the API checks authorization again before it returns the record. Logout, organization switch, role change, member removal, and password reset revoke the session's contexts. A context is not a permission.

Item mutations that must not put identifiers in the URL use `POST /api/v1/management/...` with the identifier in the JSON body. The Sprint 2 and Sprint 3 routes under `/api/v1/products`, `/api/v1/organizations`, and `/api/v1/auth` remain. Bulk changes run one record at a time, at most 50 identifiers, and return a result per identifier. Queries inside a tenant transaction run one after another so Prisma does not interleave statements on one transaction client.

Audit events stay append-only. Published product versions stay immutable. Knowledge deletion still follows retention and tombstone rules. Campaigns, meetings, analytics, SSO, WhatsApp, and the signed-out inbox stay simulated. Signed-in lead intelligence is live as of Sprint 5. Signed-in mailbox capture, drafts, and the send gate are Sprint 6. Live provider mail and live sending are not configured.

## 16. Agent management (Sprint 4)

Signed-in Command Center, AI Agents, and Execution Inspector screens use the shared management components. Add, view, and edit pages keep database ids in a session-bound navigation token. Lists paginate, sort, and search on the server. Pause, cancel, and archive confirm first. `agent_runs`, `agent_run_steps`, `agent_actions`, and `llm_usage` reject SQL `DELETE`. Policy checks external sends before any mailbox call. A paused organization does not send. A test run records steps and leaves the outbound outcome `sent: false`.

## 17. Lead intelligence (Sprint 5)

Signed-in Lead Discovery uses `LeadsDesk` and PostgreSQL. The signed-out page stays the simulated demonstration. Companies, contacts, and leads are separate records. A discovery candidate is not a lead until a person promotes the company and creates a lead. The official qualification score comes from `scoreIcp` in `packages/shared/src/crm.ts`, pinned to the published product version and ICP. A model may explain that score. It does not replace it. Missing consent stays `CONSENT_UNKNOWN`. Suppression and an active human takeover block eligibility. Quiet hours return `ALLOW`, `BLOCK`, `REQUIRE_APPROVAL`, or `UNKNOWN`. `UNKNOWN` is not permission. Sprint 5 does not send email or WhatsApp, including when a policy result is `ALLOW`.

Discovery providers that are implemented and tested are `manual` (USER PROVIDED DATA) and `test` (LOCAL TEST DATA, one fixed Northwind Logistics record). Both report `live: false`. No third-party company API is configured. Contact email and phone are AES-GCM ciphertext plus an HMAC. Suppression subjects are HMAC plus a short hint. Archive sets `archived_at`. It does not delete the row.

## 18. Lead research runs (Sprint 5.1)

`POST /api/v1/management/runs/create` accepts `planKind`. `PRODUCT_RESEARCH` keeps `buildSupervisorPlan`. `LEAD_RESEARCH_AND_QUALIFY` requires `leadId` and uses `buildLeadResearchPlan`. The plan is not chosen from the goal text. The lead plan raises that run's tool-call ceiling to 12. Product runs stay at 8.

Assignment of a lead, account, or contact calls `member_is_assignable(tenant, user)`. That function is `SECURITY DEFINER`, owned by `salesos_directory`, and returns only a boolean. `salesos_app` still cannot read `users` or call `list_user_memberships`. A human takeover is a different table and is not closed when the owner changes.

## 19. Assignment locks and CRM recovery (Sprint 5.2)

Assignment takes `pg_advisory_xact_lock(hashtextextended(tenant, 0))` and then `lock_member_for_assignment`. That function locks the tenant, user, and membership rows before it calls `member_is_assignable`. Membership removal uses the same advisory lock. Organization status changes take it as well. When a membership, user, or organization leaves `ACTIVE`, a directory-owned trigger ends open `crm_assignments` for that owner and clears `owner_user_id`. It does not update `crm_takeovers`.

`lead.qualification.explain` must return the official score, grade, and dimension fits. A payload that only repeats the score is `INSUFFICIENT_EXPLANATION`. The stored explanation then comes from the deterministic breakdown, and the qualification row does not name a model. The score still comes from `scoreIcp`.

`crm.import`, `crm.discovery`, and `crm.qualify` claim `crm_work_leases`, commit each row, and can be continued after the lease expires. A second worker refuses the job while the lease is current. Cancellation, a suspended tenant, and a revoked permission stop the job. See `docs/CRM_WORKER_RECOVERY.md` and `docs/LEAD_QUALIFICATION_EXPLANATIONS.md`.

## 20. Mailbox capture and send gate (Sprint 6 and 6.1)

Signed-in AI Conversations uses `InboxDesk` and PostgreSQL. The signed-out inbox stays simulated. A capture mailbox imports messages the user supplies. Google and Microsoft read-only sync is implemented behind OAuth and runs against provider HTTP in the worker. Before a provider response is stored, the worker rechecks the tenant, the connecting user, mailbox access, read-only scopes, the lease, and `revocation_version`. A page downloaded before revocation is discarded. A connection stays unlabeled as live until a consented mailbox has been verified. No Google or Microsoft client credentials are configured in this workspace, so live mailbox import was not executed. `evaluateSendGate` never returns a live allow. Capture success is `sent: false`. Inbox analysis runs on the existing supervisor plan `INBOX_ANALYZE_AND_DRAFT`. See `docs/SPRINT_6_2_COMPLETION.md`.
