# CODE COLONIES SALESOS
## AI-FIRST AUTONOMOUS SALES OPERATOR
### Business Requirements Document (BRD) + Software Requirements Specification (SRS) + Technical Architecture and Delivery Plan

**Document version:** 1.0 | **Date:** 03 November 2026 | **Status:** Build-ready reference specification for controlled MVP

**Sponsor:** Code Colonies Private Limited | **Initial operator:** Code Colonies | **Later audience:** Independent B2B and B2C businesses, subject to lawful channel access and tenant configuration.

> Design decision: SalesOS is an autonomous sales operator that continuously observes authorized activity and executes permitted sales actions. The SaaS dashboard, CRM and multi-tenancy are infrastructure supporting the operator, not the product's principal value. The first proof must be a real prospect-to-meeting-to-notes-to-follow-up lifecycle, not a decorative dashboard.

## 1. EXECUTIVE DECISIONS AND NON-GOALS

**Vision.** Business owners configure products, target customers, brand voice, authorized contact sources, commercial rules, calendars and connected mailboxes. SalesOS continuously sources and verifies opportunities, prepares and delivers permitted outreach, reads replies, answers accurately, qualifies needs, schedules agreed meetings, turns authorized meeting artifacts into notes, updates CRM, follows up, and escalates when human judgment is required.

**MVP success condition.** At least one real end-to-end journey with a qualified prospect: source evidence -> identity and contact validation -> approved first touch -> inbound reply -> AI qualification -> confirmed meeting -> consented transcript ingestion -> notes and action items -> approved follow-up -> audit trail. A system that only generates leads or drafts emails fails acceptance.

**Critical product boundaries.** No promise of fully autonomous outreach on platforms prohibiting bots. No covert meeting recording. No autonomous legal/commercial commitments outside approved policies. No guarantee of lead volume, response rate or revenue. No universal access to decision-maker email addresses. External mail, calendar, meetings and data providers may require user credentials, OAuth authorizations, subscriptions, usage charges or license reviews.

**MVP in scope.** 1 internal tenant with multi-tenant-ready schema and tested isolation; 1-3 products; 1 connected email mailbox; permitted prospect import and one authorized research adapter; human-approved cold first touches; autonomous low-risk replies to opted-in/inbound communications; human escalation; calendar booking; post-meeting notes from permitted transcripts or uploaded meeting text; reminders and activity supervision; tenant audit log; approval queue.

**MVP out of scope.** Bot-driven LinkedIn scraping or invitations, automatic WhatsApp messaging without correct permission and template rules, cold calling, live robotic attendance in all meeting platforms, proprietary speech-to-text model training, cross-tenant analytics, automated payment/contract signature, production self-serve billing, full SOC 2 certification, guaranteed deployment into regulated industries.

## 2. BRD: BUSINESS OBJECTIVES

**BR-001** Replace repetitive manual sales research, first-pass qualification, routine follow-up and note taking with a configurable operator. **BR-002** Support multiple products/services per tenant without code changes. **BR-003** Demonstrate value through qualified meetings held and opportunities advanced, rather than emails sent. **BR-004** Preserve source traceability and verifiable claims. **BR-005** Reduce dependency on individual salespeople while preserving human accountability for closing and high-risk activity. **BR-006** Achieve self-hosted internal operation with external cash spend <= INR 100,000, excluding existing salaries and infrastructure. **BR-007** Design SaaS tenancy, billing hooks, data isolation and authorization from day one without building public onboarding/billing in the MVP.

**Stakeholders:** Founder/sponsor (investment and strategy), CCO (commercial policies and pipeline), sales executives (qualified meetings/closings), co-founder/engineering lead (delivery), tenant admin (configuration), tenant sales manager (approvals), sales representative (handoffs), compliance/privacy administrator (data policies), prospect (communication recipient), meeting participant (recording/transcription consent), system operator (availability/security).

**Business KPI definitions:** Qualified meeting = accepted calendar event, attended or not separately recorded, with prospect-confirmed business need and decision-maker role; meeting held = attended event; SQL = opportunity with recorded pain, fit, buying process, timing, specific agreed next step; conversion = paying customer with signed order/contract. Track time-to-first-response, approved action percentage, customer complaints/opt-outs, meetings held, SQLs, deals won, gross profit, false-positive qualification and per-channel acquisition cost. Never count invite acceptance as qualification.

**Operating model:** Autonomous monitoring 24/7; outbound delivered in allowed time windows; owner approval for cold first-touch unless tenant/legal/channel policy explicitly permits configured automation; all automated messages accurately identify the business and do not impersonate a specific salesperson; human takeover available at any time.

## 3. SRS: FUNCTIONAL REQUIREMENTS

Priority convention: P0 = MVP blocking; P1 = post-MVP required for first paying SaaS customers; P2 = future.

| ID | Priority | Requirement | Verifiable acceptance |
|---|---|---|---|
| FR-001 | P0 | Tenant provisioning, settings, membership and products | All records tenant-scoped; unknown tenant ID rejected |
| FR-002 | P0 | Product/service knowledge and approved claims | Published knowledge version tied to generated response; cannot invent unavailable facts |
| FR-003 | P0 | ICP and buying-signal configuration per product | Add/edit ICP and score weights without code deployment |
| FR-004 | P0 | Authorized prospect import and research adapter | Provenance URL, collection timestamp, source terms, deduplication recorded |
| FR-005 | P0 | Contact channel permissions, jurisdiction rules, opt-out | Suppressed recipient cannot be queued or sent any marketing message |
| FR-006 | P0 | Prospect scoring and research evidence | Evidence-based score with reasoning and links, uncertainty marked |
| FR-007 | P0 | Generate individualized drafts | Each factual assertion links to supporting source or approved knowledge |
| FR-008 | P0 | Human approval queue | Nothing classified requires-approval sent prior to logged approval |
| FR-009 | P0 | Connected email send/reply integration | Thread IDs, idempotent delivery and webhook/poll sync; no lost replies after retry |
| FR-010 | P0 | AI intent classification | Interested, question, objection, negative, unsubscribe, abuse, ambiguous, out-of-office, bounce |
| FR-011 | P0 | Context-aware AI replies | Respect full thread, tenant knowledge, policies, customer language, stop flags |
| FR-012 | P0 | Requirements qualification | Capture use case, scope, urgency, buying role, budget state, constraints and next step |
| FR-013 | P0 | Human handoff and take-over | Assigned staff notified; autonomous outgoing replies paused while claimed |
| FR-014 | P0 | Calendar availability and confirmed booking | No booking unless recipient agrees and slot remains available; timezone explicit |
| FR-015 | P0 | Meeting lifecycle and artifact ingestion | Store participant permissions, transcript source, retrieval status and failure reasons |
| FR-016 | P0 | Meeting summary and task extraction | Summary references transcript spans; owners/dates only when grounded, otherwise unassigned |
| FR-017 | P0 | Follow-up supervisor | Schedule permitted follow-ups; stop upon opt-out, meeting, negative or takeover |
| FR-018 | P0 | Pipeline activity watchdog | Detect unanswered interested leads, stale tasks, missed meeting notes and retries |
| FR-019 | P0 | Audit, replay, metrics | Every external side effect tracked, deduplicated and inspectable |
| FR-020 | P0 | Privacy/retention/delete/export | Tenant admin can configure retention and initiate lawful deletion/export |
| FR-021 | P1 | Additional mail/calendar/meeting connectors | OAuth/permissions and revocation per connector independently |
| FR-022 | P1 | Self-service tenant signup/billing | License and deployment maturity reviewed prior to enabling |
| FR-023 | P1 | Tenant-specific A/B message tests | Never optimize on opens alone; evaluate SQL and complaints |
| FR-024 | P2 | Voice call agent / live meeting assistant | Only after lawful recording and provider authorization validated |
| FR-025 | P2 | Multilingual delivery | Explicit language detection, QA and translation review |

### 3.1 Agent control plane (not a single unconstrained prompt)

Eight role-scoped components: (1) Supervisor runs deterministic state transitions and next-action decisions; (2) Discovery suggests permitted sources and accounts; (3) Research verifies evidence; (4) Outreach creates drafts but never directly sends; (5) Conversation constructs grounded draft replies; (6) Qualification extracts structured fields; (7) Scheduler proposes verified available slots and requests buyer choice; (8) Meeting Intelligence summarizes artifacts and creates proposed tasks. A Policy Engine and Tool Gateway sit outside LLM control. LLMs suggest actions in typed JSON; server-side authorization decides execution.

Supervisor runs event-driven on inbound mail, calendar events, meeting artifacts, status changes and queue retries plus periodic watchdog sweep. No long-running LLM loop is necessary. Worker tasks must have maximum execution, tool and token budgets and a dead-letter queue.

### 3.2 Autonomy policy

**AUTO:** sync authorized mail, save notes, tag/score leads, detect opt-out, notify sales, create draft tasks, send an authorized meeting confirmation or routine inbound answer where verified and permitted. **APPROVAL:** first outbound campaigns initially; proposals, discount offers, final meeting note distribution, deleting important CRM records. **HUMAN ONLY:** binding price/contract commitments, legal compliance guarantees, unusual data requests, disputes, refunds, restricted-platform DMs, identity-verification claims. Tenant can reduce but cannot override platform/legal restrictions.

**Kill switches:** tenant-wide pause; per-campaign pause; per-channel pause; per-conversation takeover; global emergency outbound disable. Mandatory suppression processing is never paused.

### 3.3 Conversation behavior and escalation

One contact can have multiple conversation threads; account and prospect identity merges require a reviewable decision. Incoming message classification must run before generation. Unsubscribe/stop -> immediate suppression and one minimal acknowledgement where appropriate; bounce -> quarantine; unclear identity -> do not leak prior account context; interested -> ask only missing qualification fields; commercial terms not documented -> escalate. Never pressure buyers or fabricate company research, urgency, affiliations, customer references or pricing.

Conversation memory: last 20 relevant messages plus compact cited summary; retrieval of approved product knowledge per tenant/product and current policy version; model returns {intent, confidence, facts_used, missing_fields, proposed_message, suggested_next_action, escalation_reason}. All actions validated against JSON schema and allowed enums.

### 3.4 Meeting lifecycle

Prospect expresses willingness -> fetch free/busy -> propose 2-3 slots with timezone -> receive explicit confirmation -> create event with conferencing link -> sync attendees -> reminders governed by tenant policy -> meeting ends -> fetch transcript/recording/notes only if provider supports, permissions granted and required disclosure/consent exists -> summarize -> action-items with owners/deadlines and evidence references -> human review for external distribution -> send permitted recap -> track tasks and next meeting. If no transcript, mark unavailable and allow authorized salesperson to enter notes; never synthesize alleged quotes.

Support **post-meeting intelligence** before live meeting attendance. Google Meet supports meeting records, transcripts, entries and smart notes where available and authorized. Feature entitlement and OAuth scopes vary. Other providers must be implemented via their documented APIs, not inferred web scraping. For in-person meetings, upload an explicitly consented transcript or manually entered notes. Consent and legal basis vary by geography; obtain appropriate review before enabling recording.

## 4. QUALITY ATTRIBUTES / NFRs

| ID | Constraint | MVP acceptance |
|---|---|---|
| NFR-01 | Availability | Target >=99% excluding planned maintenance; alert when job backlog or sync failures exceed threshold |
| NFR-02 | Latency | Inbound email detected within <=5 minutes in 95% of controlled tests; AI reply drafted <=60 seconds post-ingest excluding provider outage |
| NFR-03 | Recovery | Failed jobs retry with exponential backoff; external actions idempotent; dead-letter recoverable |
| NFR-04 | Tenant isolation | Negative tests prove no cross-tenant reads/writes, search retrieval or outbound recipient mixing |
| NFR-05 | Security | TLS, at-rest database encryption/disk encryption, encrypted OAuth tokens, secrets separation, RBAC and audit |
| NFR-06 | Privacy | Data minimization, configurable retention, legitimate source/permission evidence, erase/export workflow |
| NFR-07 | AI evaluation | >=95% classification accuracy on agreed labeled pilot set; zero invented claims/unauthorized promises in critical regression set |
| NFR-08 | Traceability | Every sent message links to policy decision, content, approval, knowledge version and delivery receipt |
| NFR-09 | Observability | Structured logs with correlation IDs; health endpoint, queue latency, error metrics and exception alerts |
| NFR-10 | Performance | 5 concurrent tenant workers and 1,000 leads in test tenant without job loss; benchmark on actual VPS hardware |
| NFR-11 | Maintainability | Connector interface tests and automated migration/rollback; infrastructure documented |
| NFR-12 | Accessibility | Keyboard-accessible primary workflows and appropriate labels / status messages |

## 5. ARCHITECTURE

```text
Next.js Control Center / Tenant Admin
        | HTTPS / JWT or secure session
NestJS API Gateway / RBAC / Policy Engine
        |------- PostgreSQL + pgvector (tenant scoped, RLS)
        |------- Redis / BullMQ (jobs, locks, retries)
        |------- Object storage (consented artifacts; encryption)
        |
Tool Gateway (enforces permissions + rate limits + idempotency)
  |-- Discovery adapters (authorized public/licensed sources)
  |-- Email connector (SMTP/IMAP or provider OAuth APIs)
  |-- Calendar connector (free/busy and create event)
  |-- Meeting artifact connector (authorized transcript retrieval)
  |-- Notifications (email/internal)
        |
AI Orchestrator (typed prompts + RAG + evaluations)
  |-- Provider adapter: Ollama / OpenAI-compatible / other
  |-- Scoped retrieval: product documents and policies
        |
BullMQ workers: discover, enrich, draft, approve, send,
reply, qualify, schedule, meeting-artifacts, notes, watchdog
```

**Deployment shape:** Docker Compose services `reverse-proxy`, `web`, `api`, `worker`, `postgres`, `redis`, `object-store(optional)`, `llm(optional)`, `backup`; one Contabo Ubuntu VPS for controlled MVP if benchmarked capacity permits. For SaaS scale separate DB, queue and worker nodes, offsite backups and dedicated secrets management.

**Tenant boundaries:** `tenant_id UUID NOT NULL` on tenant-owned tables; PostgreSQL Row Level Security enabled with a transaction-local tenant context; application service-role privileges minimized; platform admin access separate and audited; all vector retrieval filters `tenant_id` and product access. Never use only UI filters for isolation. Workers obtain tenant-scoped credentials and set tenant context for each job.

**Multi-product:** product-level knowledge, brand voice, qualification schema, ICP, offers, schedules, response policy. Do not merge different products' claims unless tenant policy explicitly supports cross-selling and recipient context does.

**Event transport:** BullMQ for internal execution, PostgreSQL outbox for transactional external side effects, delivery receipts/inbound provider event deduplication. At-least-once delivery; idempotent processors; no false exactly-once guarantee.

### 5.1 Repository structure

```text
salesos/
  apps/web/                       # Next.js UI
  apps/api/                       # NestJS REST and auth
  apps/worker/                    # BullMQ processors + watchdog
  packages/domain/               # TypeScript entities, enums, policy types
  packages/ai/                   # LLM adapters, prompts, evals, schemas
  packages/connectors/           # mail, calendar, discovery, meetings
  packages/db/                   # migrations, SQL, RLS tests, seed
  packages/ui/                   # shared components
  infra/docker/                  # compose, proxy, monitoring, backup
  docs/adr/                      # architecture decision records
  tests/e2e/                     # prospect-to-meeting-to-followup
```

## 6. DATA MODEL / SQL SCHEMA

Use UUID PKs, UTC timestamptz, explicit status enums/checks, tenant_id, created_at and updated_at. Below is an executable **core schema outline**; developers must add all foreign keys, indexes, RLS migrations and migration tests before production.

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE tenants (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, status text NOT NULL DEFAULT 'active', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email citext UNIQUE NOT NULL, display_name text, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE memberships (tenant_id uuid NOT NULL REFERENCES tenants(id), user_id uuid NOT NULL REFERENCES users(id), role text NOT NULL CHECK(role IN ('owner','admin','sales_manager','sales_rep','analyst','compliance_viewer')), PRIMARY KEY(tenant_id,user_id));
CREATE TABLE products (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), name text NOT NULL, status text NOT NULL DEFAULT 'draft', offering_type text, policy_version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE knowledge_documents (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, product_id uuid NOT NULL REFERENCES products(id), source_uri text, content_hash text NOT NULL, version integer NOT NULL, approval_status text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE icps (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, product_id uuid NOT NULL REFERENCES products(id), spec jsonb NOT NULL, weights jsonb NOT NULL, version integer NOT NULL DEFAULT 1);
CREATE TABLE accounts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, legal_name text NOT NULL, domain text, country_code char(2), research_status text NOT NULL DEFAULT 'new', score numeric(5,2), created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE contacts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, account_id uuid REFERENCES accounts(id), name text, role_title text, email_encrypted bytea, email_hash text, country_code char(2), lawful_contact_basis text, contact_status text NOT NULL DEFAULT 'unverified', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE evidence (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, account_id uuid NOT NULL REFERENCES accounts(id), source_url text NOT NULL, observed_at timestamptz NOT NULL, claim text NOT NULL, source_type text NOT NULL, confidence numeric(4,3), expires_at timestamptz);
CREATE TABLE campaigns (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, product_id uuid NOT NULL REFERENCES products(id), name text NOT NULL, status text NOT NULL DEFAULT 'draft', channel text NOT NULL, policy jsonb NOT NULL DEFAULT '{}'::jsonb);
CREATE TABLE opportunities (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, account_id uuid NOT NULL REFERENCES accounts(id), product_id uuid NOT NULL REFERENCES products(id), owner_user_id uuid REFERENCES users(id), stage text NOT NULL DEFAULT 'researching', qualification jsonb NOT NULL DEFAULT '{}'::jsonb, next_action_at timestamptz, expected_monthly_value numeric(14,2));
CREATE TABLE conversations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, contact_id uuid NOT NULL REFERENCES contacts(id), campaign_id uuid REFERENCES campaigns(id), opportunity_id uuid REFERENCES opportunities(id), channel text NOT NULL, provider_thread_id text, state text NOT NULL DEFAULT 'uncontacted', human_owned boolean NOT NULL DEFAULT false, last_message_at timestamptz);
CREATE TABLE messages (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, conversation_id uuid NOT NULL REFERENCES conversations(id), provider_message_id text, direction text NOT NULL, sender_kind text NOT NULL, content_ciphertext bytea NOT NULL, sent_at timestamptz, received_at timestamptz, policy_decision_id uuid, UNIQUE(tenant_id,provider_message_id));
CREATE TABLE approvals (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, action_type text NOT NULL, target_id uuid NOT NULL, payload_hash text NOT NULL, status text NOT NULL DEFAULT 'pending', requested_at timestamptz NOT NULL DEFAULT now(), decided_by uuid REFERENCES users(id), decided_at timestamptz);
CREATE TABLE suppression (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, channel text NOT NULL, recipient_hash text NOT NULL, reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,channel,recipient_hash));
CREATE TABLE calendar_connections (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, provider text NOT NULL, owner_user_id uuid NOT NULL REFERENCES users(id), encrypted_token_ref text NOT NULL, status text NOT NULL DEFAULT 'active');
CREATE TABLE meetings (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, opportunity_id uuid REFERENCES opportunities(id), provider text NOT NULL, provider_event_id text, scheduled_start timestamptz, scheduled_end timestamptz, timezone text NOT NULL, status text NOT NULL DEFAULT 'proposed', consent_status text NOT NULL DEFAULT 'unknown', artifact_status text NOT NULL DEFAULT 'pending');
CREATE TABLE meeting_artifacts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, meeting_id uuid NOT NULL REFERENCES meetings(id), artifact_type text NOT NULL, provider_resource_id text, storage_key text, consent_record_id uuid, retention_until timestamptz, status text NOT NULL);
CREATE TABLE meeting_notes (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, meeting_id uuid NOT NULL REFERENCES meetings(id), summary jsonb NOT NULL, citation_map jsonb NOT NULL DEFAULT '{}'::jsonb, review_status text NOT NULL DEFAULT 'draft', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE tasks (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, opportunity_id uuid REFERENCES opportunities(id), meeting_id uuid REFERENCES meetings(id), owner_user_id uuid REFERENCES users(id), title text NOT NULL, due_at timestamptz, status text NOT NULL DEFAULT 'open', source_ref jsonb);
CREATE TABLE integrations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, type text NOT NULL, provider text NOT NULL, credential_ref text NOT NULL, scopes text[], status text NOT NULL DEFAULT 'active');
CREATE TABLE action_outbox (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, action_type text NOT NULL, idempotency_key text NOT NULL, payload jsonb NOT NULL, status text NOT NULL DEFAULT 'pending', attempts integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,idempotency_key));
CREATE TABLE audit_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, actor_type text NOT NULL, actor_id text, event_type text NOT NULL, object_type text, object_id uuid, correlation_id uuid, detail jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now());
```

**Schema completion checklist:** `CREATE EXTENSION citext`, typed enum migrations, composite `(tenant_id, id)` constraints or application checks preventing cross-tenant FK references; indexes on status/due_at and provider IDs; RLS policies on every tenant table including vector embeddings; PII encryption and search-safe tokenization; cascading policies reviewed; retention and DSAR deletion; schema versioning; backups/restore test. A tenant_id alone is NOT adequate isolation when foreign keys can cross tenant boundaries.

**Recommended indexes:** `accounts(tenant_id,domain)` unique where domain exists; `contacts(tenant_id,email_hash)` unique when present; `conversations(tenant_id,provider_thread_id)` partial unique; `messages(tenant_id,conversation_id,received_at DESC)`; `opportunities(tenant_id,stage,next_action_at)`; `action_outbox(status,created_at)`; `audit_events(tenant_id,created_at DESC)`; `evidence(tenant_id,account_id,expires_at)`.

## 7. API CONTRACTS

**Convention:** `/api/v1`; JSON; authenticated session or OAuth; `X-Tenant-Id` checked against membership rather than trusted blindly; `Idempotency-Key` mandatory for side effects; RFC7807-style error bodies `type,title,status,detail,correlationId`; cursor pagination; timestamps ISO8601 UTC; validation via Zod/class-validator. External webhook endpoints use signature verification, replay window and event IDs.

| Method/path | Permission | Request -> response / note |
|---|---|---|
| POST `/tenants` | platform admin | `{name}` -> tenant id |
| POST `/products` | tenant admin | `{name,offeringType}` -> id |
| PUT `/products/:id/knowledge` | admin | `{documentIds,approvedVersion}` -> indexed status |
| POST `/icps` | admin/manager | `{productId,spec,weights}` -> id |
| POST `/prospects/import` | manager | `{sourceId,records[]}` -> batch job id |
| POST `/prospects/research` | manager | `{accountIds[],sourcePolicy}` -> job id |
| GET `/accounts?cursor=` | tenant roles | account page, sources, scores |
| POST `/campaigns` | manager | `{productId,channel,policy}` -> campaign id |
| POST `/campaigns/:id/drafts` | manager | `{accountIds[]}` -> draft job id |
| POST `/approvals/:id/decision` | approver | `{decision,reason,payloadHash}` -> audit receipt |
| POST `/conversations/:id/reply-draft` | rep/manager | `{contextVersion}` -> typed candidate response |
| POST `/conversations/:id/takeover` | rep/manager | `{ownerUserId}` -> human-owned state |
| POST `/conversations/:id/release` | rep/manager | `{policyMode}` -> AI eligible state |
| POST `/opportunities/:id/qualify` | manager/agent | structured requirements -> qualification snapshot |
| POST `/meetings/propose` | agent/rep | `{opportunityId,timeZone,duration}` -> verified available slots |
| POST `/meetings/confirm` | agent/rep | `{slotId,contactConfirmationId}` -> provider event id |
| POST `/meetings/:id/artifacts/sync` | agent/authorized role | provider artifact sync job id |
| POST `/meetings/:id/notes/generate` | agent/rep | `{artifactIds[]}` -> draft notes id |
| POST `/meeting-notes/:id/approve` | manager/rep | `{approved,edits}` -> released notes |
| GET `/sales-supervisor/alerts` | manager/rep | stale, overdue, escalation alerts |
| GET `/metrics/funnel` | manager/analyst | date/product/channel metrics |
| POST `/webhooks/email/:provider` | provider signature | dedupe receipt, enqueue parser |
| POST `/webhooks/calendar/:provider` | provider signature | meeting state reconciliation |

**Sample request: approval**

```json
{"decision":"approve","reason":"Relevant public buying signal verified","payloadHash":"sha256:..."}
```

**Sample `SalesActionProposal` (internal typed schema)**

```json
{"tenantId":"uuid","conversationId":"uuid","action":"reply","risk":"low","policyVersion":7,"knowledgeVersion":3,"claims":[{"text":"Supports API integrations","sourceId":"doc:123"}],"message":"Thanks for the details...","requiresApproval":false,"idempotencyKey":"reply:provider-message-123:v1"}
```

**Provider adapter contracts:** `DiscoveryAdapter.search(query,limit,policy)->EvidenceCandidate[]`; `MailAdapter.send(message,idempotencyKey)->DeliveryReceipt`; `MailAdapter.sync(cursor)->InboundEvent[]`; `CalendarAdapter.freeBusy(range,participants)->Slot[]`; `CalendarAdapter.book(slot,attendees)->Event`; `MeetingArtifactAdapter.list(meeting)->ArtifactMetadata[]` and `download(artifact)->Bytes`; `LLMProvider.complete(schema,context,budget)->TypedResult`. Each adapter declares supported scopes, costs, rate limits, legal constraints and health.

## 8. STATE MACHINES / EVENTS

**Lead:** `new -> researched -> eligible -> outreach_pending -> contacted -> engaged -> qualifying -> qualified -> meeting_requested -> meeting_booked -> meeting_held -> opportunity_active -> won|lost|nurture`; `suppressed|invalid|disqualified` terminal for outbound until explicit authorized change. Do not transition to qualified solely from model score. Every stage stores transition actor, reason and timestamp.

**Conversation:** `uncontacted -> draft_pending -> approval_pending -> sent -> waiting_reply -> inbound_received -> classifying -> ai_reply_pending -> ai_sent -> waiting_reply`; alternative `human_takeover`, `suppressed`, `closed`, `error_review`. New reply during `human_takeover` must not enqueue automatic send.

**Meeting:** `proposed -> accepted -> booking_pending -> confirmed -> in_progress -> completed -> artifacts_waiting -> notes_draft -> notes_reviewed -> followup_queued -> closed`; alternative `declined`, `cancelled`, `no_show`, `artifact_unavailable`. Provider record cannot override the prospect's consent requirement.

**Approval:** `requested -> approved|rejected|expired|revoked`; payload hash changes invalidate approval. Sending requires approved payload hash match and policy re-evaluation immediately before send.

**Event examples:** `prospect.researched`, `outreach.approved`, `email.sent`, `email.received`, `lead.intent_detected`, `prospect.opted_out`, `meeting.confirmed`, `meeting.completed`, `transcript.available`, `notes.generated`, `task.overdue`, `ai.escalated`, `campaign.paused`.

**Idempotency rules:** event id unique per provider; outbound `messageId+approvedVersion`; calendar `opportunityId+confirmedSlotId`; tasks `meetingId+sourceArtifact+actionHash`; detect retries and return prior result. Failure handling: retry transient network errors with exponential backoff and jitter, dead-letter after bounded attempts, alert owner, never retry unsubscribe handling by sending marketing content.

## 9. ROLES / PERMISSIONS

| Operation | Owner | Admin | Sales manager | Sales rep | Analyst | Privacy viewer | Agent |
|---|---|---|---|---|---|---|---|
| Configure tenant/integrations | Yes | Yes | No | No | No | Read | No |
| Approve product knowledge/policy | Yes | Yes | Delegated | No | No | Audit | No |
| Create campaigns | Yes | Yes | Yes | Draft | No | No | Draft only |
| Approve cold outreach | Yes | Yes | Yes | Delegated | No | No | No |
| View assigned conversations | Yes | Yes | Yes | Assigned | Aggregates | Audit scoped | Scoped |
| Take over conversation | Yes | Yes | Yes | Assigned | No | No | No |
| Book confirmed meeting | Yes | Yes | Yes | Assigned | No | No | Policy-scoped |
| Read meeting transcript | Yes | Authorized | Authorized | Assigned+authorized | No | Audit scoped | With consent+purpose |
| Send external post-meeting summary | Yes | Yes | Yes | Delegated | No | No | Only preapproved policy |
| Export/delete personal data | Yes | Authorized | No | No | No | Authorized | Workflow request only |
| Review audit/AI behavior | Yes | Yes | Yes | Own records | Aggregate | Privacy audit | Append only |

Use ABAC in addition to roles: assigned owner, product access, consent scope, geographic restriction, tenant policy version and channel grant. Support service-to-service identities distinct from human users.

## 10. SECURITY, PRIVACY AND COMPLIANCE

**Auth:** OIDC-compatible identity; short-lived sessions, MFA for admins, server-side authorization; CSRF protection for cookie-based auth; per-tenant RBAC and RLS. **Credentials:** OAuth where supported, encrypt tokens at rest with a master key outside DB, rotate, revoke promptly; do not put access tokens into LLM context. **Data:** TLS 1.2+, encrypted disks/backups, sensitive body ciphertext, data-minimizing logs, PII redaction from diagnostics, signed storage URLs, object access checks. **App:** OWASP ASVS-inspired controls, validation, egress allowlists, SSRF protections on URLs, attachment scanning, dependencies/SBOM, CI secrets scanning. **AI:** retrieved content and emails untrusted; prompt-injection defense, tool-output escaping, grounded-source checks, JSON schema validation, model regression suite; never let an email instruct the agent to change policy or access secrets. **Operations:** daily backup plus tested restore, incident runbook, privilege reviews, tenant deletion/retention process and alerting.

**Outreach:** country-by-country channel legality review; legitimate contact/source permissions and purpose limitation; platform API policies; unsubscribe and do-not-contact suppression; truthful sender and subject; recorded consent/objection where relevant; no purchased list laundering. India DPDP Act/Rules and other country-specific privacy/marketing laws require legal review for each deployment context. Email sender SPF/DKIM/DMARC and monitoring required. LinkedIn explicitly disallows unauthorized automated scraping and invitations; never bypass restrictions. No claim that publicly visible data always permits automated direct marketing.

**Meeting intelligence:** require meaningful disclosure and appropriate consent/legal basis before recording/transcribing; do not secretly join meetings or scrape meeting UI; show transcript source and accuracy caveat; user controls retention; avoid analyzing employees for performance surveillance when provider policies disallow it. Google Meet provider transcripts are the recommended initial path when available to an authorized Workspace user; fallback is participant-supplied transcript or manual notes.

**Compliance gates before external SaaS launch:** Privacy notice, DPA, subprocessors, data retention/deletion, data residency disclosures, terms, incident response, cross-border transfer assessment, approved connector scopes and consent controls, documented lawful bases, legal counsel signoff.

## 11. UI / UX MODULES

**U-01 Command Center:** operator status, today's autonomous actions, stuck jobs, high-intent replies, human queue, revenue funnel; one-click pause and takeover. **U-02 Product Studio:** company profile, products, ICP, knowledge documents, price/discount boundaries, brand voice, FAQ, qualification rules, testing. **U-03 Discovery Lab:** source connector, filters, research evidence, freshness, duplicate review, prospect score, why relevant. **U-04 Campaign Console:** target segments, sending windows, consent policies, sequence design, cost cap, approval dashboard. **U-05 Unified Inbox:** thread with human/AI messages identified, citations, qualification panel, draft review, takeover, unsubscribe. **U-06 Pipeline:** stages, owner, next action, potential value, evidence and commercial risk. **U-07 Meeting Center:** calendars, confirmed events, participant permissions, transcript status, notes, action items and email recap review. **U-08 AI Supervisor:** pending actions, exception alarms, autonomous work history, policy decisions, replay/evaluation. **U-09 Analytics:** channel/product cohorts, meetings held, SQLs, cycle time, conversion, cost, mistakes, complaint metrics. **U-10 Tenant Admin:** roles, OAuth connections, secrets reference, limits, retention, billing hooks, audit/export.

Every autonomous action must show **why**, **which evidence**, **what permission**, **what was sent**, and **how to reverse/stop future actions**. AI communications must be clearly marked in the operator UI.

## 12. ENGINEERING SPRINT BACKLOG

Assume 1 primary full-stack engineer, 0.5 additional frontend/integration engineer, part-time QA/DevOps and founder/CCO product review. 8 weeks is a target internal MVP schedule, dependent on capacity and credentials. Do not treat all eight weeks as new cash cost; salary opportunity cost is additional.

**Sprint 0 (3-5 days):** Architecture decision records, workload audit, legal/channel policy inventory, VPS CPU/RAM/disk benchmarking, product onboarding inputs, baseline acceptance dataset, threat model. Exit: approved scope and actual capacity.

**Sprint 1 (Week 1):** Docker Compose, auth, tenant membership, RLS migrations, audit framework, product knowledge upload and policy configuration. Tests: tenant isolation negative suite, backup restore, RBAC.

**Sprint 2 (Week 2):** Evidence-backed lead import and authorized discovery adapter, dedupe, ICP scoring, research UI. Tests: source attribution, duplicate prevention, stale evidence flags.

**Sprint 3 (Week 3):** LLM adapter, retrieval, prompt injection defenses, personalized draft generation and approval gate. Tests: no unsupported claims across 50 adversarial and standard scenarios.

**Sprint 4 (Week 4):** Email account integration, send outbox, inbound sync/webhook, threading, opt-out/bounce state. Tests: 100 duplicate/late provider events and no double send.

**Sprint 5 (Week 5):** Conversation intent and context-aware qualification, escalation, human takeover, next-action supervisor. Tests: >=95% on labeled intent set; takeover blocks AI send.

**Sprint 6 (Week 6):** Calendar adapter, verified slot proposal, booking, meeting lifecycle, reminders. Tests: double-booking/clock shift/timezone/decline cases.

**Sprint 7 (Week 7):** Meet transcript retrieval where authorized, uploaded transcript fallback, grounded meeting notes and tasks, reviewable follow-up. Tests: consent missing -> no artifact retrieval; all summary claims tied to spans or marked uncertain.

**Sprint 8 (Week 8):** Full E2E controlled pilot, dashboard/alerts, hardening, runbook, restore and failover rehearsal, budget review. Exit: complete prospect -> contact -> reply -> qualified -> meeting -> notes -> follow-up chain with real provider integrations and signed pilot report.

### 12.1 Detailed acceptance matrix

| Test | Stimulus | Expected |
|---|---|---|
| AT-01 | Product B tenant tries reading Product A data | 403/404 and audit; no content disclosed |
| AT-02 | Two imports contain same account/domain | One canonical account; two provenance records |
| AT-03 | Source contains fake AI instruction | Ignored as data; no policy change or tool invocation |
| AT-04 | Product FAQ lacks price | Agent asks/reviews; does not fabricate pricing |
| AT-05 | Cold outreach with pending approval | No delivery side effect |
| AT-06 | Approved payload edited | Approval invalidated; new review required |
| AT-07 | Email provider delivers same inbound event twice | One inbound message and one reply job |
| AT-08 | Recipient says stop | Immediate suppression; no further campaign sends |
| AT-09 | Recipient replies interested with questions | Knowledge-grounded answer + capture missing fields |
| AT-10 | Price negotiation outside policy | Agent escalates; no binding offer sent |
| AT-11 | Human claims thread | AI outbound paused until released |
| AT-12 | Two buyers select same calendar slot | Provider recheck, one booking; offer alternatives |
| AT-13 | Meeting lacks transcript/consent | No recording retrieval; actionable fallback shown |
| AT-14 | Transcript contains ambiguous action owner | Task owner unset and review requested |
| AT-15 | Worker killed after provider send before ACK | Idempotent reconciliation, no duplicate external message |
| AT-16 | Weekly watchdog finds overdue positive inquiry | Alert and permitted next-step task created |
| AT-17 | Connector token revoked | Safe halt, user reauthorization request, no silent fallback |
| AT-18 | Tenant requests erasure | Data/deletion workflow follows retention legal holds and audit |
| AT-19 | Budget cap reached | Expensive discovery/LLM jobs stopped; critical inbound/suppression flows continue |
| AT-20 | End-to-end pilot journey | Auditable lead -> meeting held -> grounded notes -> follow-up |

## 13. ONE-TIME INR 100,000 CASH BUDGET

| Item | Ceiling (INR) | Trigger |
|---|---:|---|
| Legal/privacy and channel review | 15,000 | Before enabling external outbound/recording |
| Mail deliverability/domain and integration | 10,000 | Connector pilot |
| Lead source/API pilots | 15,000 | After source terms reviewed |
| AI usage and evaluation | 12,000 | Model benchmark |
| Extra VPS/storage/backup/security | 13,000 | After benchmark identifies gap |
| Meeting integrations/transcript testing | 5,000 | Meeting sprint |
| UX/testing/operator pilot | 10,000 | Week 6+ |
| Contingency, not precommitted | 20,000 | Sponsor approval |
| **Total maximum** | **100,000** | **Hard cash cap** |

**Release gates:** Up to INR 20,000 in discovery and security review; up to INR 35,000 for reliable email/research/AI integration; up to INR 25,000 for calendar/meeting/controlled pilot; preserve INR 20,000 contingency. If costs exceed budget, remove SaaS polish and live features—not opt-out/security/consent controls. Operating subscriptions and internal engineering compensation are not funded by this cash envelope. Pricing and lead sources must be revalidated with live vendor quotes.

**Operating budget controls:** per-tenant monthly AI tokens/rupees, discovery API requests, contacts per day, email volume, active workers, recording/storage retention and circuit breakers; real-time spend dashboard; cost ledger by action/campaign/tenant. Avoid claiming zero-subscription global outreach.

## 14. RISKS, DEPENDENCIES AND PRODUCT RELEASE GATES

**R1 Market-fit:** AI speed does not fix a weak offer; measure qualified meetings vs manual baseline. **R2 Data supply:** public sources may be incomplete, stale or legally restricted; implement evidence and adapter health. **R3 Email deliverability:** new mailboxes/poor sender reputation may harm results; warm legitimate accounts, authenticate and limit volumes. **R4 AI hallucination:** grounded replies, approval rules, regression testing. **R5 Cross-tenant leak:** RLS and integration cross-tenant tests; highest severity. **R6 Meeting consent:** provider recordings unavailable or unauthorized; fallback notes, no covert bots. **R7 Infrastructure:** no adequate GPU on VPS; use small provider API or lower-concurrency local model. **R8 Security:** tokens and PII exposed to untrusted email content; strict tool segregation. **R9 Cost:** LLM/data usage may exceed budget; hard limits. **R10 Third-party policy changes:** graceful degradation and adapter replacements. **R11 Workload:** five mid-level developers have existing obligations; reserve limited verified capacity. **R12 Commercialization:** internal MVP is not equivalent to public SaaS readiness.

**GATE A Architecture:** threat model, allowed sources, retention and consent decisions signed. **GATE B Messaging:** no sends without appropriate permission/approval, verified suppression, deliverability passed. **GATE C AI:** critical response and classification test suite passed. **GATE D Meetings:** timezone-safe booking and consented artifact pipeline works. **GATE E Pilot:** real controlled end-to-end lifecycle recorded and reviewed. **GATE F SaaS beta:** isolation, operations, privacy contracts, billing, support, runbooks, recovery tested.

## 15. FIRST 90 DAYS / RELEASE PLAN

**Days 1–14:** Discover allowed lead source(s), connect mailbox, configure products/ICPs, deploy platform, secure 30 evidence-backed target accounts, 20 approved drafts. **Days 15–30:** Controlled first-contact campaign, monitor real replies, evaluate categorization/qualification and suppression. **Days 31–45:** Meeting booking and automatic internal note generation from authorized transcript; capture CCO feedback. **Days 46–60:** Harden AI responses and audit, run up to three campaigns across different products/target markets; compare SQL conversion and cost. **Days 61–90:** Run repeatable internal campaigns, set weekly reporting, test multi-tenant isolation with second staging tenant, determine whether to commercialize or improve own sales acquisition first.

**Commercial success criteria after 90 days (hypothesis):** the platform reliably executes permitted actions end-to-end, creates auditable qualified meeting opportunities without false claims, and improves time spent per opportunity. Number of qualified meetings cannot be guaranteed; a zero-meeting outcome triggers evaluation of product-market fit, contact source, offer and deliverability rather than indiscriminately increasing outbound volume.

## 16. OPEN DECISIONS / ASSUMPTIONS TO RESOLVE IN SPRINT ZERO

1. Existing Contabo Ubuntu instance: CPU, RAM, disk, GPU, public IPv4, backup and operating system version; choose Ollama vs hosted model after benchmark.
2. Current business email provider and domain(s), mailbox ownership, API/IMAP support, sender reputation, SPF/DKIM/DMARC status.
3. Primary meeting provider: Google Meet vs Microsoft Teams vs Zoom; transcript entitlement and organization admin approval.
4. Initial approved lead data provider and permitted public research sources; contact/legal basis for each launch country.
5. First three products/services and their source-of-truth docs, approved claims, pricing guardrails and forbidden promises.
6. Team capacity for engineering, QA and product ownership, and CCO approval SLA.
7. Retention duration for contact data, email bodies, meeting transcripts, recordings and audit trails, including legal hold.
8. Initial permitted outbound geography and whether tenant policy allows any automatic first touch after legal review.
9. Definition of success: actual held qualified meetings, proposal progression, win rate and operating cost, not contact volume.

## 17. OFFICIAL REFERENCE POINTS (VERIFY AT IMPLEMENTATION)

- Google Meet REST API overview: https://developers.google.com/workspace/meet/api/guides/overview (meeting spaces, conference records, transcripts, smart notes, permissions).
- Google Meet transcript endpoint: https://developers.google.com/workspace/meet/api/reference/rest/v2/conferenceRecords.transcripts/list (OAuth scope and availability constraints).
- LinkedIn automated activity policy: https://www.linkedin.com/help/linkedin/answer/a1341543 (unauthorized scraping and browser automation prohibited).
- LinkedIn prohibited software details: https://www.linkedin.com/help/linkedin/answer/a1341387/prohibition-of-scraping-software?lang=en .
- India DPDP Rules notification, PIB, November 2025: https://www.pib.gov.in/PressNoteDetails.aspx?ModuleId=3&NoteId=156054&lang=2 .

**Final architecture principle:** Product independence at the configuration layer; maximum safe autonomy at the workflow layer; verification and lawful authorization at every boundary. Build and prove the full sales lifecycle before building subscription billing and cosmetic SaaS features.


---

# SALESOS ENTERPRISE EXTENSION — AUTHENTICATION, CONFIGURATION, WHATSAPP & GOVERNANCE
## Addendum to Code Colonies SalesOS AI-First BRD, SRS and Technical Architecture

**Version:** 2.0 | **Date:** 4 November 2026 | **Owner:** Code Colonies Private Limited | **Classification:** Internal engineering handoff

> **Status:** This document specifies requirements, proposed defaults and acceptance criteria; the visual boards are conceptual reference images, not implemented screens or proof of a running integration. The architecture is multi-tenant and vendor-neutral, and must not hardcode any specific Code Colonies product.

## 1. BUSINESS REQUIREMENTS AND SCOPE

**BR-E01 — Enterprise readiness.** Organizations must authenticate through local credentials or supported federated identity, administer roles, audit events, and enforce per-tenant policies without modifying application code.

**BR-E02 — Fully configurable experience.** Users and tenant admins control locale, dates, timezone, business hours, email preferences, notifications, brand, agent policies, customer qualification rules and integration-specific values according to permissions.

**BR-E03 — Extensible connectors.** Every third-party connector is defined by a versioned provider manifest, validated credential schema, editable configuration, capability set, OAuth/scopes or API credentials, webhook configuration, health tests, error reporting and audit history. Arbitrary secret fields are not permitted to bypass server-side validation.

**BR-E04 — WhatsApp business conversations.** Allow businesses with authorized Meta WhatsApp Business Platform access to receive messages, route conversations to AI or humans, send appropriate replies, manage approved templates, observe messaging windows, handle opt-outs and monitor delivery outcomes.

**BR-E05 — Autonomous but accountable.** The Supervisor can autonomously act only through policy-gated tool interfaces. Tenant-level and agent-level permissions must be checked again server-side before any external side effect. Nothing bypasses compliance, consent or authorization rules by using a different channel.

**BR-E06 — Secure enterprise evidence.** Identity actions, configuration changes, connector use, AI decisions and outgoing messages must produce attributable, tenant-isolated audit events. Sensitive values must not appear in logs, exports or UI screenshots.

### 1.1 Priorities and delivery boundaries

| Priority | Functionality | Delivery gate |
|---|---|---|
| P0 internal MVP | Email/password or existing SSO provider; reset flows; session security; roles; base preferences; connector framework; email; WhatsApp webhook adapter in sandbox; logs | Release after security and consent tests |
| P1 enterprise pilot | Multiple OIDC providers; SAML through proven library/broker; MFA and recovery; SCIM; WhatsApp production template management; tenant data exports; secure webhooks | Pilot customer and specialist security review |
| P2 enterprise scale | Advanced conditional access, just-in-time provisioning, data residency, retention hold, enterprise SIEM, provisioning workflows, tenant-managed encryption keys | Enterprise requirement and paid roadmap |

**Non-goals in MVP:** universal WhatsApp/LinkedIn messaging access; turnkey compliance certification; transparent recording of meetings without participant permission; unlimited service-provider connectors at zero cost; passwordless magic link without abuse controls; universal provider properties known in advance.

## 2. ENTERPRISE UI/UX SCREEN REGISTER

Screen IDs are stable engineering identifiers. Each screen must provide loading, error, empty, offline/expired-session and access-denied variants as appropriate. Buttons must not claim success before server confirmation.

| ID | Route suggestion | Screen | Mandatory user interaction |
|---|---|---|---|
| AU-01 | /auth/login | Enterprise sign in | Email/password, show/hide, remember device/session, SSO redirect, errors |
| AU-02 | /auth/forgot-password | Forgot password | Generic confirmation even if account does not exist, resend throttling |
| AU-03 | /auth/reset-password | Reset password | One-use link, new password, confirm, expired/used token states |
| AU-04 | /auth/mfa | Verify second factor | TOTP/passkey or recovery code, retry/lockout, remember trusted device policy |
| AU-05 | /auth/sso | Choose organization/provider | Domain-based discovery, OIDC/SAML entry, safe redirect, failure states |
| AU-06 | /auth/invite | Accept invitation | Verified tenant invitation, membership acceptance, expiration |
| AU-07 | /auth/locked | Locked/suspended account | Non-disclosing support path and retry/administrative unlock |
| AU-08 | /auth/recovery | Recovery and emergency access | Backup codes, admin emergency workflow, notifications |
| ST-01 | /settings/profile | User profile | Name, avatar, language, contact info, accessibility |
| ST-02 | /settings/preferences | Regional preferences | IANA timezone, locale, date/time/number/currency format, week start |
| ST-03 | /settings/notifications | Notification preferences | Per-event email/in-app/digest and quiet hours |
| ST-04 | /settings/email | Email preferences | Sender identity, signature, reply-to, thread rules, sending window |
| ST-05 | /settings/organization | Tenant settings | Name, domain, branding, business hours, defaults and subdomain |
| ST-06 | /settings/users | Users and invitations | Invite, deactivate, role assignment, bulk status, last activity |
| ST-07 | /settings/roles | Roles and permissions | Permission matrix, custom role policies, effective permissions |
| ST-08 | /settings/security | Security policies | MFA enforcement, SSO-only, password, lockout, session settings |
| ST-09 | /settings/sessions | Active devices and sessions | Device, IP approximation, last active, revoke, sign out everywhere |
| ST-10 | /settings/sso | Identity providers | OIDC/SAML setup, test, certificate rotation, domains, JIT, SCIM |
| ST-11 | /settings/audit | Security audit logs | Search/filter, event detail, export permission, retention |
| ST-12 | /settings/data | Privacy & retention | Export, delete workflows, retention, masking and residency flags |
| IN-01 | /integrations | Connector catalog | Search/filter by category/capability, install, show status |
| IN-02 | /integrations/new | Add custom connector | Select manifest template, allowed properties and auth mode |
| IN-03 | /integrations/:id | Connector configuration | Dynamic settings form, masked credentials, tests, scopes, logs |
| IN-04 | /integrations/:id/webhooks | Webhook manager | Endpoint, signature validation, secrets rotation, replay, failures |
| IN-05 | /integrations/:id/mappings | Field/event mapping | Source-to-domain schema, transformations, preview and validation |
| IN-06 | /integrations/:id/logs | Connector operations | API errors, retries, health, quotas, billing hints |
| WA-01 | /channels/whatsapp | WhatsApp overview | WABA connection, number status, activity, quality/rate flags |
| WA-02 | /channels/whatsapp/bot | AI bot configuration | Knowledge selection, automation level, fallback and escalation |
| WA-03 | /channels/whatsapp/inbox | WhatsApp inbox | Media/text messages, AI/human switch, source message IDs |
| WA-04 | /channels/whatsapp/templates | Approved templates | Locale, category, variables, provider approval status |
| WA-05 | /channels/whatsapp/flows | Bot workflows | Intent → policy → AI action → reply/escalate visual flow |
| WA-06 | /channels/whatsapp/opt-ins | Consent and preferences | Opt-in evidence, purpose, unsubscribe, consent withdrawal |
| WA-07 | /channels/whatsapp/insights | Channel analytics | Response latency, handoffs, delivery failure, opt-outs |
| AG-01 | /agents | Agent control center | Agent statuses, approvals, scopes, models, prompt versions |
| AG-02 | /agents/:id | Agent detail | Inputs, outputs, tools, autonomy, memory, budget and audit |
| AG-03 | /agents/runs/:id | Execution inspector | Trigger, evidence, planning, policy verdict, tool receipt, retry |
| AG-04 | /approvals | Human approval inbox | Approve/reject/reassign, reason and immutable action record |
| MT-01 | /meetings/:id/intelligence | Meeting intelligence | Recording disclosure, transcript, notes, action ownership |

### 2.1 Layout/design language

Desktop: 240px persistent sidebar, compact top navigation, 12-column content grid, detail inspector drawer. Mobile: collapsible navigation and one-column cards. Design tokens: primary violet #673DE6, dark navy #161633, teal success #0D9488, surfaces #FFFFFF/#F6F7FC; minimum AA contrast for body text and focus outlines. Support dark/light/system theme, reduced-motion and keyboard navigation. The accompanying boards illustrate visual direction, not literal production strings or actual lead counts.

## 3. AUTHENTICATION SRS (AU)

| ID | Priority | Functional requirement | Acceptance criteria |
|---|---|---|---|
| AU-FR-001 | P0 | Local sign-in with verified email, Argon2id password hashing, normalized identity | Invalid and nonexistent login yield equivalent public response; no plaintext credentials stored |
| AU-FR-002 | P0 | Forgot password flow uses random one-use expiring token stored as hash | Token replay and post-expiry requests fail; no account enumeration; reset invalidates other reset links |
| AU-FR-003 | P0 | Successful reset revokes existing sessions and notifies account owner | Previously valid sessions return 401; notification does not expose secrets |
| AU-FR-004 | P0 | Remember me controls session persistence, not browser credential storage | Disabled uses short default session; enabled uses policy-defined maximum and device visibility |
| AU-FR-005 | P0 | Secure session cookies with HttpOnly, Secure, SameSite and CSRF defense as required | Stolen/expired/revoked token fails; logout revokes server-side session |
| AU-FR-006 | P0 | Tenant isolation for all authentication memberships | Valid user cannot access another tenant via manipulated tenant_id/header |
| AU-FR-007 | P1 | OIDC Authorization Code + PKCE SSO, issuer/audience/nonce/state verification | Mismatched state, signature, nonce or redirect rejected; domain claim validated |
| AU-FR-008 | P1 | SAML 2.0 via vetted implementation, ACS URL, signed assertions, replay protection | Invalid signature, audience, InResponseTo, timestamp and duplicate assertion rejected |
| AU-FR-009 | P1 | MFA with TOTP and WebAuthn passkeys; secure recovery codes | Reuse of recovery code rejected; step-up access required for sensitive actions |
| AU-FR-010 | P1 | Admin-managed SSO-only and MFA policies by tenant | Policy enforced for new and existing sessions; emergency break-glass audited |
| AU-FR-011 | P1 | Identity lifecycle: invitation, join, suspend, remove, SCIM optional | Deactivated user loses all sessions and tokens immediately |
| AU-FR-012 | P0 | Rate limit, suspicious-login detection, backoff and lockout without easy denial-of-service | Automated attack simulations throttled; support recovery path remains available |
| AU-FR-013 | P0 | Configurable inactivity/absolute session limits and concurrent-session policy | Session obeys documented limits and tenant defaults; device revocation propagates |
| AU-FR-014 | P1 | Audit IP, user-agent, auth factor and outcome with minimized data | Viewable by permitted security admin; no passwords, raw session tokens or OTP secrets logged |

**Proposed default policies (tenant overridable with minimum security floor):** password minimum 12 characters when local sign-in is allowed, breached-password check where feasible, no forced periodic rotation without a security reason, TOTP or passkey for privileged accounts, 30-minute inactivity / 12-hour absolute admin sessions, 7-day normal user absolute session, optional remember-device up to 30 days based on risk and tenant policy, reset link TTL 15 minutes, 5 failed login attempts per account/IP window with adaptive controls. These require final security risk assessment; do not represent one-size-fits-all standard requirements.

**SSO account linking:** only link a federated identity after checking stable provider `sub`/NameID and explicit secure linking policy; never auto-link solely because a raw email matches. Organization discovery must resist tenant enumeration. Support multiple providers per tenant behind configuration but allow tenant-approved defaults. Test without activating globally.

## 4. USER AND ORGANIZATION PREFERENCES

Preference resolution order: `user override -> tenant default -> product default`. Server stores UTC timestamps; API responses use ISO 8601 with offset or UTC; UI renders using IANA timezone. Do not persist fixed GMT offsets as the user timezone because daylight-saving rules change.

| Property | Type / example | Scope | Validation and behavior |
|---|---|---|---|
| display_name | UTF-8 string | User | Length limit, escaping |
| locale | `en-IN` | User/tenant | BCP 47 identifier |
| timezone | `Asia/Kolkata` | User/tenant | Valid IANA timezone |
| date_format | `dd/MM/yyyy` | User/tenant | Allowed format tokens only |
| time_format | `12h` / `24h` | User/tenant | Explicit selection |
| week_starts_on | `monday` | User/tenant | Enumerated |
| currency | `INR` | Tenant/user display | ISO 4217 code |
| number_format | `en-IN` | User | Locale-based grouping |
| theme | `light`,`dark`,`system` | User | Accessible contrast |
| reduced_motion | boolean | User | Respect accessibility setting |
| language | `en` | User | Supported language catalog |
| email_signature | sanitized rich text | User/tenant | Safe HTML allowlist; preview |
| from_name | verified business identity | Tenant/mailbox | Sender verification enforced |
| reply_to | verified email | Tenant/mailbox | Domain/address validation |
| notifications | per-event channels | User | Email/in-app/digest toggles |
| digest_frequency | daily/weekly/none | User | Sends at local preference time |
| quiet_hours | `[start,end,tz]` | User/tenant | DST-aware; inbound not blocked |
| business_hours | weekdays and windows | Tenant/campaign | DST-aware and holiday-aware |
| holidays | calendar references | Tenant | Import/override support |
| default_meeting_length | minutes | User/tenant | 15/30/45/60 with policy range |
| meeting_buffer | minutes | User | Prevent overlapping bookings |
| AI_default_tone | Enum + approved custom | Tenant/product | Versioned prompt settings |
| AI_signature_disclosure | template | Tenant | Must not misrepresent automated identity |
| daily_send_cap | integer | Tenant/channel | Cannot exceed provider/policy ceiling |
| retention_profile | policy ID | Tenant | Compliance admin restricted |

**Preference changes:** optimistic concurrency via `version`; audit old/new nonsecret settings; re-render previews; timezone changes must not mutate stored UTC scheduled instants unless user explicitly reschedules.

## 5. THIRD-PARTY CONNECTOR FRAMEWORK (PROVIDER-AGNOSTIC)

The application must accept an extensible *schema-driven* set of properties for each installed connector, rather than a giant form with hardcoded Gmail/WhatsApp-only inputs. Each provider publishes a versioned manifest; the tenant config contains values validated against that manifest. Administrators can add all supported provider fields, including provider-specific `advancedProperties` in a defined namespace, but cannot introduce arbitrary executable code or unknown secret keys.

### 5.1 Generic connector object

```json
{
  "key": "whatsapp_cloud",
  "manifestVersion": "1.0.0",
  "category": "messaging",
  "capabilities": ["inbound_messages", "outbound_messages", "templates", "delivery_receipts"],
  "auth": {"type": "secret_reference", "secretRef": "vault://tenant/connector/wa/token"},
  "providerConfig": {"wabaId": "...", "phoneNumberId": "...", "graphApiVersion": "version-approved-by-adapter"},
  "webhooks": {"enabled": true, "verifyTokenSecretRef": "vault://...", "signatureSecretRef": "vault://..."},
  "mapping": {"externalContactId": "contact.external_id"},
  "limits": {"maxPerMinute": 20, "retryPolicy": "exponential"},
  "health": {"status": "unverified", "lastCheckedAt": null},
  "enabled": false
}
```

### 5.2 Required connector settings groups

| Group | Property examples | Validation / controls |
|---|---|---|
| Identity | display name, provider, category, tenant scope, environment | Stable provider IDs; tenant-scoped |
| Authentication | OAuth authorize/token URLs, client ID, client secret ref, scopes, API key ref, token expiry | Credential encryption, restricted hosts, rotation, scopes preview |
| Connection | base URL, API version, region, proxy policy, TLS certificate validation | URL allowlist; SSRF protection; TLS mandatory |
| Webhooks | callback URL, event subscriptions, signature scheme, verification tokens, replay window | HMAC/signature verification; idempotency |
| Data mapping | objects, fields, direction, transforms, conflicts, null handling | Type checking, sample dry run |
| Scheduling | poll interval, sync cursor, batching, time windows | Rate and provider quota controls |
| Reliability | retries, backoff, timeout, circuit breaker, dead-letter behavior | No duplicate external side effects |
| Governance | consent requirements, data classification, retention, country rules | Server-side policy enforcement |
| Observability | logs, health, error categories, quota usage, delivery receipts | Mask secrets and PII |
| Extension | provider namespaced JSON Schema fields | Schema-validated and versioned only |

**Connector state machine:** `DRAFT -> AUTHORIZING -> CONNECTED -> DEGRADED -> DISCONNECTED`, with `TESTING`, `EXPIRED`, `REVOKED` and `ERROR` substates. Tokens and webhook secrets must be rotatable with no downtime where supported. A failed test cannot mark the integration connected.

**Initial providers:** generic SMTP/IMAP and supported OAuth email (Google/Microsoft), Google/Microsoft calendar, Meta WhatsApp Business Platform, webhooks, CSV import, one permitted research adapter. HubSpot/Salesforce/Pipedrive/Slack/Teams/Zoom and other connectors are extension targets, not claims of functioning integrations in MVP.

## 6. WHATSAPP BUSINESS AUTOMATION AND AI BOT

**Access model:** use the official WhatsApp Business Platform / Cloud API or an authorized provider, with properly owned or permitted WhatsApp Business Account (WABA), phone number, app permissions, required business verification where applicable, access token, callback verification, configured webhook subscriptions and appropriate messaging templates. Pricing and conversation/template rules are provider-controlled and can change; read current official terms during implementation and release.

**WhatsApp setup UI fields:** provider and environment; business portfolio ID; WABA ID; phone number ID; verified display name; callback URL; verification-token secret reference; signing/app-secret reference; access token/credential reference; Graph API version; token expiry/status; subscribed webhook events; subscribed message statuses; message window indicator; approved template catalog; template locale/category/variables; media policy; recipient consent source/purpose/timestamp; sending limits; business hours; fallback support agent/team; response tone/language; LLM/provider/model; model cost/token cap; human takeover; handoff SLA; restricted topics; stop words/opt-outs; do-not-contact list; message retention; testing recipient; last health check and error status.

### 6.1 Incoming message pipeline

`Verified webhook -> dedup external message ID -> tenant/phone binding -> normalized message/media -> consent and suppression checks -> conversation ownership check -> intent classifier -> knowledge retrieval -> action policy -> generated candidate -> groundedness/claims check -> send through provider -> store provider receipt -> update CRM/audit`.

### 6.2 Outbound template pipeline

`campaign request -> jurisdiction and consent policy -> audience verification -> provider-approved template + language -> variable validation -> permitted window check -> budget + limits -> approval (where required) -> send -> receipt webhook -> monitor delivery / opt-out`.

### 6.3 WhatsApp AI bot controls

| Control | Allowed settings | Enforcement |
|---|---|---|
| Bot operating mode | OFF / DRAFT / AUTONOMOUS-INBOUND / POLICY-CONTROLLED | Server tools verify mode before sending |
| Knowledge scope | Chosen product versions, FAQs, attachments | Tenant and publication-version scoped |
| Qualification | Configurable slots and scoring rules | Structured JSON state, no invented facts |
| Escalation | Pricing, legal advice, frustration, low confidence, VIP, explicit human request | Claim owner and pause AI outbound |
| Message frequency | Per contact/day, campaign, permitted session | Provider/channel + tenant policy minimum |
| Working hours | IANA timezone + weekdays + holidays | Only permitted sends; inbound monitored continuously |
| Consent | Purpose, source, timestamp, lawful basis policy | No marketing send without required permission |
| Media | MIME allowlist, size, antivirus scanning, expiry | Reject unsafe and oversize attachments |
| Language | Auto-detect with fallback and supported locales | Human review on unsupported language |
| Template use | Provider-approved status and variables | Reject unapproved or mismatched template |
| Logging | Delivery ID, policy verdict, response version | Never store tokens or unnecessary sensitive text in audits |

**Acceptance:** inbound messages are visible within an operational target of 30 seconds under normal conditions; webhook signature is verified; retries do not duplicate responses; opt-out halts marketing sends immediately; a conversation outside a permitted service window never sends an ordinary free-form business-initiated response; approved templates are used only when eligibility is satisfied; unsupported pricing/legal commitments route to human review. These are proposed targets, not provider guarantees.

## 7. AUTHORIZATION AND ROLE MODEL

Permissions are resource/action pairs with tenant scope and optional constraints (`own`, `team`, `all`). A role never grants access outside its tenant. Platform support access requires a documented just-in-time, time-bounded, customer-approved support session with complete audit.

| Permission family | Examples | Default allowed roles |
|---|---|---|
| org.* | org.read, org.update, domain.verify, billing.read | Owner/admin |
| identity.* | user.invite, user.disable, role.manage, sso.manage, session.revoke | Security admin / owner |
| connector.* | connector.read, connector.configure, connector.test, connector.rotate_secret | Integration admin / owner |
| campaign.* | campaign.create, campaign.launch, campaign.pause | Marketing manager / sales manager |
| lead.* | lead.read, lead.edit, lead.export, contact.suppress | Sales role per assigned scope |
| messaging.* | draft.create, message.approve, message.send, template.manage | Agent policy + sales manager |
| ai.* | agent.configure, model.select, agent.run, run.inspect, autonomy.change | AI admin / owner |
| meeting.* | meeting.book, transcript.read, notes.approve, recording.manage | Meeting owner / authorized manager |
| audit.* | audit.read, audit.export, security.policy.update | Security auditor/admin |
| data.* | data.export, data.erase, retention.manage | Privacy admin / owner |

**Separation of duties:** A person configuring a risky connector cannot automatically waive its security review; access to audit logs does not imply ability to alter logs; sales reps cannot change tenant authentication or data retention; AI agents cannot assign themselves new permissions. Custom roles may be created by tenant admin only within tenant policy ceilings.

## 8. PERSISTENCE AND SQL SCHEMA ADDENDUM

The schema below extends the existing `tenants`, `users`, `tenant_memberships`, `audit_events`, `integrations`, `conversations`, `messages`, `agent_runs` and `meetings` tables. UUID primary keys, tenant foreign keys, indexed creation times and row-level security should be applied consistently. Secret *values* never live in normal configuration JSON.

```sql
CREATE TABLE identity_providers (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id),
 protocol text NOT NULL CHECK (protocol IN ('oidc','saml')),
 name text NOT NULL, issuer text, metadata_url text,
 config jsonb NOT NULL DEFAULT '{}', secret_ref text,
 status text NOT NULL DEFAULT 'draft', verified_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,name)
);
CREATE TABLE user_sessions (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id),
 user_id uuid NOT NULL REFERENCES users(id), token_hash text NOT NULL UNIQUE,
 device_label text, user_agent_hash text, ip_prefix inet,
 created_at timestamptz NOT NULL DEFAULT now(), last_seen_at timestamptz,
 idle_expires_at timestamptz NOT NULL, absolute_expires_at timestamptz NOT NULL,
 revoked_at timestamptz, revocation_reason text
);
CREATE TABLE account_recovery_tokens (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id),
 token_hash text NOT NULL UNIQUE, purpose text NOT NULL,
 expires_at timestamptz NOT NULL, consumed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE preference_profiles (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id),
 user_id uuid REFERENCES users(id), values_json jsonb NOT NULL DEFAULT '{}',
 version integer NOT NULL DEFAULT 1, updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,user_id)
);
CREATE TABLE connector_manifests (
 id uuid PRIMARY KEY, provider_key text NOT NULL, manifest_version text NOT NULL,
 schema_json jsonb NOT NULL, capabilities jsonb NOT NULL,
 UNIQUE(provider_key,manifest_version)
);
CREATE TABLE connector_instances (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id),
 manifest_id uuid NOT NULL REFERENCES connector_manifests(id),
 display_name text NOT NULL, config_json jsonb NOT NULL DEFAULT '{}',
 secret_reference jsonb NOT NULL DEFAULT '{}', status text NOT NULL DEFAULT 'draft',
 created_by uuid REFERENCES users(id), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE connector_events (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id),
 connector_id uuid NOT NULL REFERENCES connector_instances(id),
 provider_event_id text, event_type text NOT NULL,
 received_at timestamptz NOT NULL DEFAULT now(), signature_valid boolean,
 processing_state text NOT NULL, failure_category text,
 UNIQUE(connector_id,provider_event_id)
);
CREATE TABLE whatsapp_channels (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id),
 connector_id uuid NOT NULL REFERENCES connector_instances(id),
 waba_id text NOT NULL, phone_number_id text NOT NULL,
 bot_mode text NOT NULL DEFAULT 'off',
 bot_settings jsonb NOT NULL DEFAULT '{}',
 UNIQUE(tenant_id,phone_number_id)
);
CREATE TABLE consent_records (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id),
 contact_id uuid NOT NULL, channel text NOT NULL, purpose text NOT NULL,
 status text NOT NULL, source text NOT NULL, evidence_ref text,
 recorded_at timestamptz NOT NULL, withdrawn_at timestamptz
);
CREATE TABLE access_audit_events (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id),
 actor_user_id uuid REFERENCES users(id), actor_agent_id uuid,
 event_type text NOT NULL, target_type text, target_id uuid,
 request_id text, ip_prefix inet, outcome text NOT NULL,
 sanitized_details jsonb NOT NULL DEFAULT '{}', occurred_at timestamptz NOT NULL DEFAULT now()
);
```

**Indexes/RLS requirements:** index `(tenant_id, occurred_at DESC)` audit, `(tenant_id,user_id,revoked_at)` sessions, `(tenant_id,status)` connector instances, `(tenant_id,phone_number_id)` channels; apply `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY` and tenant predicates to every customer table; use non-owner DB roles and transaction-scoped tenant context. Reject missing tenant context. RLS is defense in depth, not the only authorization check.

**Credentials:** use a secrets vault when available, or an application-level envelope-encrypted secrets store with restricted server-only access, rotation and backup keys. Do not put private client secrets, access tokens or webhook verify tokens into unencrypted JSON columns, browser localStorage or API responses.

## 9. API CONTRACT EXTENSIONS

All endpoints require tenant-aware authorization unless explicitly public (`/auth/*` and verified provider callbacks). JSON error structure: `{code,message,requestId,details?}`; secrets redacted. Write endpoints require CSRF controls for cookie-authenticated clients, version preconditions where applicable, and idempotency keys for external side effects.

| Method/path | Permission | Request/response contract |
|---|---|---|
| POST /v1/auth/login | public | `{email,password,remember}` -> session cookie + user summary |
| POST /v1/auth/forgot-password | public | `{email}` -> 202 generic confirmation |
| POST /v1/auth/reset-password | public | `{token,newPassword}` -> 204 and session revocation |
| GET /v1/auth/oidc/:provider/start | public | state/nonce/PKCE verified redirect |
| GET /v1/auth/oidc/:provider/callback | public | verified claims -> membership/session |
| POST /v1/auth/mfa/verify | session challenge | `{challengeId,code}` -> authenticated session |
| GET /v1/sessions | identity.session.read | sessions with masked metadata |
| DELETE /v1/sessions/:id | identity.session.revoke | 204 + audit |
| GET /v1/preferences | preference.read | resolved values + overrides/version |
| PATCH /v1/preferences | preference.update | `{changes,expectedVersion}` -> updated values |
| GET /v1/identity-providers | identity.sso.read | tenant provider list, no secret values |
| POST /v1/identity-providers | identity.sso.manage | validated provider config -> draft |
| POST /v1/identity-providers/:id/test | identity.sso.manage | verified test result, not auto-enable |
| GET /v1/connectors/manifests | connector.read | provider manifest catalog |
| POST /v1/connectors | connector.configure | `{manifestId,displayName,config,secretInputs}` -> instance with masked fields |
| PATCH /v1/connectors/:id | connector.configure | versioned schema-validated config update |
| POST /v1/connectors/:id/test | connector.test | asynchronous test job receipt |
| POST /v1/connectors/:id/rotate | connector.rotate_secret | rotation receipt; no secret value returned |
| GET /v1/connectors/:id/events | connector.read | paginated sanitized webhook/operation events |
| GET /v1/channels/whatsapp | channel.read | configured channels and health |
| PATCH /v1/channels/whatsapp/:id/bot | ai.agent.configure | mode, limits, knowledge, escalation with version |
| GET /v1/channels/whatsapp/:id/templates | messaging.template.read | provider-reported approvals and locales |
| POST /v1/channels/whatsapp/:id/test | channel.test | allowed test recipient and policy verdict |
| GET /v1/audit-events | audit.read | cursor pagination, filters, redacted metadata |
| POST /v1/audit-events/export | audit.export | async protected export with expiry |

**Webhook:** `GET /webhooks/meta/whatsapp` implements provider verification challenge; `POST /webhooks/meta/whatsapp` validates request signature over raw body, resolves known phone number IDs, deduplicates event IDs, responds promptly, enqueues processing and handles retries. Never accept tenant identity from unverified webhook body alone.

## 10. THREAT MODEL AND SECURITY CHECKLIST

| Threat | Mitigation | Acceptance test |
|---|---|---|
| Credential stuffing and account enumeration | Adaptive limits, non-disclosing errors, security monitoring | Same external recovery response for existing/nonexisting account |
| SSO assertion forgery/replay | Signed claims/assertions, issuer, audience, state/nonce, replay cache | Forged/replayed callback rejected |
| Tenant breakout / IDOR | Tenant context, object authorization, RLS, negative tests | Cross-tenant read/write always denied |
| CSRF / XSS | CSRF token or safe same-site strategy, CSP, HTML sanitization | Stored XSS and CSRF regression tests pass |
| Token/key leakage | Vault/secret refs, masked UI, encrypted backups, log redaction | Secret canary absent in API/log exports |
| SSRF via custom connector | Host allowlist, block private/link-local IP ranges, safe DNS/TLS | Access to metadata/internal services denied |
| Webhook forgery | Signature checks, timestamps/replay protection, idempotency | Invalid signatures return 4xx; duplicate no double send |
| Prompt injection from lead websites/WhatsApp | Treat inputs as untrusted, policy gate outside LLM, scoped tool tokens | Malicious text cannot invoke unauthorized send/export |
| Sending unauthorized marketing messages | Consent, policy, opt-out and template checks | Suppressed contacts never receive marketing sends |
| AI invented contract terms | Retrieval grounding, price policy, human approval | Unsupported discount/legal commitment blocked |
| Audit modification | Append-only writes, access restrictions, off-host copies as available | No API route permits alteration of past events |
| Misconfigured timezone/meeting | UTC storage and IANA conversions, DST tests | Correct scheduling across DST changes |

Security baseline: target OWASP ASVS 5.0 controls appropriate to the deployment, with particular emphasis on identity, session management, access control, logging and error handling. Complete a documented threat model and independent review before enabling unattended outbound automation for external tenants.

## 11. ACCEPTANCE TEST SUITE (REPRESENTATIVE, AUTOMATABLE)

| Test ID | Given | When | Then |
|---|---|---|---|
| AT-AU-01 | Unknown email address | Forgot password submitted | Public response is generic, timing approximately comparable; no account disclosure |
| AT-AU-02 | Valid unused reset token | Password reset twice | First succeeds; second rejected; old sessions invalid |
| AT-AU-03 | SSO callback with altered `state` | Callback processed | Login denied and security audit logged |
| AT-AU-04 | Valid user in tenant A | Requests tenant B config | 403/404, no data leakage |
| AT-AU-05 | User with revoked session | Calls API | 401, refresh denied |
| AT-PF-01 | `Asia/Kolkata` timezone | User views UTC event | Displays appropriate local time without changing UTC stored event |
| AT-PF-02 | Upcoming DST shift in US | Scheduler generates slots | Slots honor IANA timezone rules |
| AT-CN-01 | Connector missing mandatory property | Admin saves form | Field-level validation errors; no secret persisted |
| AT-CN-02 | API key secret configured | Admin reopens settings | Only masked state visible; never raw secret |
| AT-CN-03 | Invalid webhook signature | Event received | Rejected, audited, no agent run triggered |
| AT-CN-04 | Duplicate webhook provider ID | Event retried | Exactly one normalized event and side-effect job |
| AT-WA-01 | Customer opted out | Outreach agent schedules marketing template | Action blocked and reason logged |
| AT-WA-02 | No eligible WhatsApp send window | Agent drafts ordinary outbound text | Send blocked; policy-based approved template path considered only if eligible |
| AT-WA-03 | Prospect requests a human | AI bot receives request | AI outgoing stopped; sales owner notified |
| AT-WA-04 | Customer asks unsupported price | Bot generates price promise | Policy gate denies; price clarification escalated |
| AT-SEC-01 | Sales rep login | Accesses SSO secrets | Access denied; audit event logged |
| AT-SEC-02 | Admin changes role/retention | Configuration saved | Structured before/after metadata logged with sensitive values redacted |
| AT-SEC-03 | Secret-canary test string | API, job and audit events run | Canary absent from log exports |
| AT-UX-01 | Keyboard-only user | Navigates login and settings | Visible focus, labels and error messages accessible |
| AT-AI-01 | LLM creates unauthorized action proposal | Supervisor processes response | Policy-gated tool rejects external side effect |
| AT-AI-02 | Agent plans message sending | Provider returns failure | UI shows failed/retry, never sent/completed |

## 12. DESIGN SCREENSHOTS AND DESIGN-TO-BUILD NOTES

The package includes two multi-screen concept boards:

1. `screens/enterprise_auth_settings_board.png` — login, forgot password, reset password, MFA, SSO chooser, agent overview, agent execution, regional preferences, connector marketplace, WhatsApp AI bot and audit.
2. `screens/enterprise_integrations_whatsapp_board.png` — SSO settings, configuration panels, integrations, WhatsApp AI, agent settings, execution inspector, approvals, meeting notes, enterprise security and globals.

**UI evidence limitation:** These are AI-generated *conceptual screenshots*, with placeholder company identities, sample values and visually implied integrations. They are not actual browser screenshots, validated working provider connections, implementation proof or pixel-perfect specifications. The screen register, API contracts and tests above define the implementation behavior. Before engineering signoff, convert each visual into Figma/components and resolve text/content accuracy.

## 13. DELIVERY SPRINTS AND ONE-TIME BUDGET

| Sprint | Deliverables | Gate |
|---|---|---|
| 0 (week 1) | Threat model, screen map, tenant permission matrix, provider-manifest contract | Reviewed architecture and ownership |
| 1 (weeks 2–3) | Login/recovery/session/audit, preferences, secure connector vault abstraction | Authentication negative tests pass |
| 2 (weeks 4–5) | OIDC SSO starter, provider manifest forms, connector tests, integration logs | SSO and connector tests pass |
| 3 (weeks 6–7) | WhatsApp sandbox webhook, bot rules, inbox, template catalog mock/sync | Verified webhook and opt-out tests |
| 4 (weeks 8–9) | Human approvals, AI action policy, security center, responsive UX | E2E approved/blocked simulations pass |
| 5 (weeks 10–12) | Pilot hardening, backup/recovery, telemetry, docs, regression | Security review and acceptance sign-off |

These are sequencing estimates assuming dedicated capacity; they are not guaranteed build dates. Real SAML/SCIM, multiple production connectors, broad WhatsApp business rollout and enterprise certification should be budgeted separately after the initial MVP.

| One-time external budget line | INR ceiling |
|---|---:|
| Security design/independent review support | 20,000 |
| Test identity/mail/provider configurations | 10,000 |
| WhatsApp sandbox and compliant test messaging | 8,000 |
| AI inference / prompt evaluation | 10,000 |
| VPS backups, monitoring and secure storage | 12,000 |
| UX/accessibility validation and testing | 10,000 |
| Contingency / external API surprises | 30,000 |
| **TOTAL** | **100,000** |

**Budget assumptions:** existing salary cost, existing VPS, business mailbox subscription, bespoke enterprise SAML/SCIM integration engineering, certifications and long-term production WhatsApp charges are excluded. If budget is constrained, prioritize identity/session security, basic configurable preferences, secure provider connector framework and sandbox WhatsApp; do not launch external multi-tenant unattended sales without security verification.

## 14. IMPLEMENTATION REFERENCES (OFFICIAL MATERIAL TO VERIFY AGAIN AT DEPLOYMENT)

- OWASP ASVS 5.0: https://asvs.owasp.org/
- OWASP security logging: https://github.com/OWASP/ASVS/blob/master/5.0/en/0x25-V16-Security-Logging-and-Error-Handling.md
- Microsoft SAML vs OIDC implementation guidance: https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/saml-vs-oidc-decision-guide
- Meta WhatsApp Business Platform documentation: https://developers.facebook.com/docs/whatsapp/cloud-api/
- Meta WhatsApp business messaging policy: https://business.whatsapp.com/policy

**Definition of enterprise-ready:** all implemented features have functional, authorization, observability, privacy and recovery tests; independent threat/security review completed; no advertised integration is labeled "connected" without verified provider acknowledgment; customer data retained/processed under documented policies; and operations can monitor outages, recover backups and revoke credentials.
