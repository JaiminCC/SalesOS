# SalesOS database design

**Status:** Design only. `schema.sql` is not applied by this run, and Prisma is not added.  
**Date:** 4 November 2026  
**Engine:** PostgreSQL 16. Migrations owned by Prisma, with follow-on SQL for RLS, partial unique indexes, and composite foreign keys that Prisma must not "simplify" away.  
**Reference:** `sales-os-docs/Code_Colonies_SalesOS_Developer_Package/schema.sql`. This document is the delta and the operating rules. Where they differ, migrations follow this document and keep the reference constraints.

## 1. Rules that every table follows

- Primary keys are UUID. New rows use UUIDv7 when the database or application can generate it. `gen_random_uuid()` is acceptable in the first migration.
- Tenant-owned tables use composite primary key `(tenant_id, id)` and composite foreign keys `(tenant_id, other_id) → parent(tenant_id, id)`. A row cannot point at another tenant's parent.
- `timestamptz` stored in UTC. The UI formats with the user's IANA zone.
- Optimistic lock column `version` on aggregates that workers and humans edit (accounts, campaigns, leads, conversations, drafts, notes, agent actions).
- JSONB is for provider payloads, ICP documents, and policy constraints. Relationships are columns and foreign keys.
- PII and secrets are ciphertext (`bytea`) plus a key id. Emails that must be deduplicated also store `email_hmac` (HMAC-SHA256 of the normalized address with a tenant HMAC key).
- Application role: `salesos_app`. No superuser, no `BYPASSRLS`, no DDL. Migrations run as `salesos_migrator`.
- Tenant data: `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY`. Policy:

```text
USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
WITH CHECK (same expression)
```

Missing `app.tenant_id` matches zero rows. Inserts without it fail the check.

- Connection use: one interactive transaction, `SELECT set_config('app.tenant_id', $1, true)`, then queries, then commit. Never `SET` at session scope on a pooled connection.
- Platform tables (`tenants`, `users`, credentials, sessions) do not use the tenant policy. They have their own policies: a user reads their user row; membership lookups happen through an explicit security-definer function owned by the migrator, or through a narrow `salesos_auth` role used only by the login path. The API request path after login uses `salesos_app` plus tenant context. This split is mandatory so login can find a user before a tenant is chosen, without giving `salesos_app` a way to scan every tenant's leads.

## 2. Platform schema

These tables are global. They are the identity boundary.

### 2.1 `tenants`

| Column | Notes |
|---|---|
| `id` | PK. |
| `name`, `slug` | Slug unique. |
| `status` | `ACTIVE`, `SUSPENDED`, `DELETED`. |
| `timezone` | IANA. Default from workspace setup, not hard-coded to `Asia/Kolkata` in code. |
| `locale`, `currency` | Display defaults. |
| `settings` | JSONB: quiet hours, retention days, model budget minor units, permitted channels. |
| `automation_status` | `RUNNING` or `PAUSED`. The kill switch. |
| `automation_paused_at`, `automation_paused_by` | Nullable. |
| `created_at` | |

Suspending a tenant is checked in the API and in the worker before external writes. RLS still applies to suspended tenants so data is not leaked during suspension.

### 2.2 `users`

| Column | Notes |
|---|---|
| `id` | PK. |
| `email_hmac` | Unique. Lookup key. |
| `email_ciphertext` | Display email. |
| `display_name` | |
| `password_hash` | Nullable when the user is SSO-only. Argon2id string. |
| `password_changed_at` | |
| `status` | `INVITED`, `ACTIVE`, `SUSPENDED`. |
| `created_at` | |

No plaintext email column.

### 2.3 Credentials and sessions

| Table | Purpose | Key constraints |
|---|---|---|
| `mfa_factors` | TOTP secret ciphertext, `verified_at`, `disabled_at`. | One active TOTP factor per user in MVP. |
| `recovery_codes` | Hash only, `used_at`. | Single use. |
| `sessions` | `user_id`, hashed session token, `expires_at`, `absolute_expires_at`, `revoked_at`, `user_agent`, `ip_hash`, `mfa_satisfied`. | Token hash unique. Revocation is a timestamp, not a delete, until retention cleanup. |
| `password_reset_tokens` | Hash, `expires_at`, `used_at`. | Do not store the raw token. |
| `auth_attempts` | `ip_hash`, `email_hmac`, `succeeded`, `created_at`. | Supports lockout. No password material. |

Session rows are readable by the owning user. Admins revoke sessions inside a tenant by a membership-scoped API that sets `revoked_at`. They do not get a global user dump.

### 2.4 Membership and RBAC

| Table | Purpose |
|---|---|
| `memberships` | `(tenant_id, user_id)` PK, `status` `INVITED` / `ACTIVE` / `SUSPENDED`. |
| `roles` | `(tenant_id, id)`, `name`, `is_system`. Seed Owner, Admin, Manager, Sales, Analyst, Reviewer per tenant. Custom roles allowed with zero permissions until granted. |
| `role_permissions` | `(tenant_id, role_id, permission)`. Permission is a string from the catalog in `docs/ARCHITECTURE.md`. |
| `membership_roles` | `(tenant_id, user_id, role_id)`. |

The prototype's boolean matrix becomes rows. Owner is a system role whose permission set is not editable down to empty in MVP, so a tenant cannot lock itself out without a platform process.

`memberships` is tenant-scoped and has RLS. `roles` and grants have RLS. Creating the first owner happens in a migrator or auth-role transaction that inserts tenant and membership together.

## 3. Tenant configuration

### 3.1 Preferences and security policy

| Table | Replaces |
|---|---|
| `user_preferences` | Preferences screen: display name override, locale, timezone, date and time formats, theme, notification flags, signature, meeting defaults. PK `(tenant_id, user_id)`. |
| `tenant_security_policies` | Security Center: `mfa_required`, `sso_only`, password minimum (floor 12), idle timeout, absolute session hours, lockout threshold. One row per tenant. |

`sso_only` is stored in Phase 2 and enforced when Phase 9 turns a provider on. Until then the API refuses to set `sso_only` true if no provider is verified. The prototype allows the toggle with no provider. That behavior is not copied.

### 3.2 Products, ICP, knowledge

Preserved from `schema.sql`:

- `products` `(tenant_id, id)`, `name`, `type` (`SOFTWARE`, `SERVICE`, `HARDWARE`, `OTHER`), `status`.
- `product_versions` with `version`, `published`, `icp` JSONB, `approved_facts` JSONB, `qualification_schema` JSONB, `restrictions` JSONB. Unique `(tenant_id, product_id, version)`.
- `knowledge_documents` with `sha256`, `storage_key`, `status` (`PENDING`, `APPROVED`, `REJECTED`, `REVOKED`), `approved_by`.
- `knowledge_chunks` unique `(tenant_id, document_id, chunk_index)`.

ICP JSON shape (versioned, validated by Zod in `packages/shared`, not by a Code Colonies schema):

```text
{
  "industries": [],
  "employeeBands": [],
  "geographies": [],          // ISO country codes
  "buyerTitles": [],
  "pains": [],
  "exclusions": [],
  "evidenceRequirements": []
}
```

Qualification schema is an ordered field list: `key`, `label`, `type`, `requiredForSalesReady`. Scoring weights live here too, so "fit +24" is configuration, not a React constant.

Published versions are immutable. A publish copies the draft into a new version row with `published = true` and refuses updates. Drafts that cited a revoked knowledge document cannot be sent (FR-014).

Embeddings are a later column or `knowledge_chunk_embeddings` table with `(tenant_id, chunk_id)` and RLS. MVP retrieval may be keyword over approved chunks. Vectors are not required to ship the first grounded draft, and they must not ship without the same tenant filter.

### 3.3 Workflows

`sequences` and `sequence_steps` attach to a campaign:

- `sequences`: `(tenant_id, id)`, `campaign_id`, `max_steps`, `stop_on_reply`.
- `sequence_steps`: `position`, `delay_hours`, `channel`, `template_ref`.

The prototype's cadence number becomes `max_steps`. Channels other than `EMAIL` cannot be activated in MVP (API validation), even if the row shape allows `WHATSAPP` later.

## 4. Commercial graph

Unchanged intent from `schema.sql`. Names below are the physical tables.

| Table | Notes |
|---|---|
| `accounts` | Unique `(tenant_id, normalized_domain)` where domain is not null. `status`, `version`. |
| `contacts` | `email_ciphertext`, `email_hmac`, `source_legal_status` (`REVIEW`, `PERMITTED`, `BLOCKED`), `status`. Unique `(tenant_id, email_hmac)` where not null. |
| `source_evidence` | `source_url`, `source_url_hash`, `excerpt`, `source_type`, `license_status`, `observed_at`, `expires_at`, `confidence`. Required for any signal the model is allowed to cite. |
| `campaigns` | `status` `DRAFT` / `ACTIVE` / `PAUSED` / `ARCHIVED`, `daily_send_cap` 0–1000, `approval_mode`, `timezone`, `config` JSONB, `version`. |
| `campaign_products` | Links a campaign to specific `product_version_id`s. |
| `leads` | `campaign_id`, `account_id`, `contact_id` nullable, `state`, `score` 0–100, `score_reasons` JSONB, `owner_user_id`, `version`. |
| `opportunities` | One or more per lead. `stage`, `estimated_value_minor`, `currency`, `next_action_at`. Currency comes from the tenant or the opportunity, not from a rupee formatter. |
| `suppression_entries` | `contact_hash`, `scope`, `reason` (`OPTOUT`, `COMPLAINT`, `HARD_BOUNCE`, `MANUAL`, `LEGAL`). Unique `(tenant_id, contact_hash, scope)`. |

### 4.1 Lead states

`DISCOVERED → RESEARCHED → ELIGIBLE → DRAFTED → APPROVAL_PENDING → CONTACTED → ENGAGED → QUALIFYING → SALES_READY → MEETING_REQUESTED → MEETING_BOOKED → HANDOFF → WON | LOST`.

Terminal from pre-handoff states: `SUPPRESSED`, `DISQUALIFIED`, `ARCHIVED`. `CONTACTED → BOUNCED`. `ENGAGED → HUMAN_OWNED`.

The prototype's `New`, `Research`, `Engaged`, `Qualified`, `Meeting` are view labels over this set. The mapping table lives in `packages/shared` and is covered by a unit test so the Lead Discovery badges do not invent a second lifecycle.

Transitions are a table in code, applied with `UPDATE ... WHERE version = $expected`. A racing worker gets 409.

### 4.2 Conversations and mail

| Table | Notes |
|---|---|
| `conversations` | `lead_id`, `channel`, `state`, `human_owned`, `provider_thread_id`, `version`. |
| `messages` | `direction` `INBOUND` / `OUTBOUND`, `body_ciphertext`, `status`, `provider`, `provider_message_id`, `source_evidence_ids`. Unique `(tenant_id, provider, provider_message_id)` when the provider id is present. |
| `outreach_drafts` | `subject`, `body`, `status`, `facts` JSONB (evidence ids), `approved_by`, `approved_at`, `version`. Editing bumps `version` and clears approval. |
| `qualification_answers` | Unique `(tenant_id, lead_id, field_key)`. `value` JSONB, `source_message_id`, `confidence`. |

Conversation states: `NEW → TRIAGED → AI_ACTIVE → QUALIFYING → MEETING_OFFERED → HUMAN_OWNED | CLOSED`. Opt-out closes the conversation and writes suppression. Human ownership stays until an authorized release.

Outbound message states: `DRAFT → POLICY_CHECKED → AWAITING_APPROVAL → APPROVED → QUEUED → SENDING → SENT → DELIVERED`, plus `REJECTED`, `BLOCKED`, `FAILED_RETRYABLE`, `FAILED_PERMANENT`, `BOUNCED`, `CANCELLED`.

`SENT` requires `provider_message_id` or an explicit `AMBIGUOUS` reconciliation state. The UI label "Sent" is allowed only for `SENT` or `DELIVERED`.

## 5. Meetings, notes, tasks

| Table | Notes |
|---|---|
| `meetings` | `conversation_id`, `status`, `starts_at`, `ends_at`, `timezone`, `provider_event_id`, `buyer_confirmed_at`. |
| `meeting_artifacts` | `artifact_type`, `source`, `provider_id`, `storage_key`, `sha256`, `consent_attested`, `consent_evidence`, `retention_until`, `status`. Unique `(tenant_id, meeting_id, sha256)`. |
| `meeting_segments` | `segment_index`, `speaker_label`, `start_ms`, `end_ms`, `text_ciphertext`, `confidence`. |
| `meeting_notes` | `note_json`, `schema_version`, `review_status`, `generated_model`, `source_artifact_id`. |
| `meeting_action_items` | `evidence_segment_ids`, `confidence`, `status` `NEEDS_REVIEW` or `ACCEPTED`, optional `task_id`. |
| `sales_tasks` | `owner_user_id`, `related_lead_id`, `related_meeting_id`, `source_event_id`, `title`, `status`, `due_at`, `priority`. |

Meeting states follow BRD §10.4, including `NO_TRANSCRIPT` and `PROCESSING_FAILED`. A completed calendar event is not a transcript.

`meeting_action_items.evidence_segment_ids` is an array. The reference SQL says strict foreign keys for that array need a bridge table. Add `meeting_action_item_evidence (tenant_id, action_item_id, segment_id)` in the first notes migration so citations cannot dangle. The array may remain as a denormalized cache or be dropped. The bridge table is the constraint.

Notes JSON fields are those in BRD §29.3. Material claims require `source_segments`. Missing dates stay null.

## 6. Agent persistence

| Table | Notes |
|---|---|
| `automation_policies` | `autonomy_level` `A0`–`A4`, optional `channel`, optional `action_type`, `constraints` JSONB, `version`, `effective_at`. |
| `agent_runs` | `trigger_type`, `source_event_id`, `state`, `model_provider`, `model_name`, `prompt_version`, `input_redacted` JSONB, `started_at`, `finished_at`, `error_code`, `parent_run_id` nullable for replays. |
| `agent_run_steps` | **Added.** `(tenant_id, id)`, `run_id`, `position`, `name`, `status`, `detail_redacted`. This is what Execution Inspector renders. Steps are written by the worker, not by the browser. |
| `agent_actions` | `run_id`, `action_type`, `target_type`, `target_id`, `risk_level`, `policy_version`, `policy_decision`, `state`, `requires_human_approval`, `approved_by`, `due_at`, `attempts`, `idempotency_key` unique per tenant, `payload` JSONB, `outcome` JSONB. |
| `llm_usage` | **Added.** `(tenant_id, id)`, `run_id`, `provider`, `model`, `input_tokens`, `output_tokens`, `cost_minor`, `currency`, `created_at`. Budget checks sum this table. |

Pause is `tenants.automation_status` plus `agent_runs.state = PAUSED`. Resume does not delete actions. It inserts a new attempt or moves `PAUSED → QUEUED` under a compare-and-swap, then policy runs again.

Retries increment `agent_actions.attempts`. `FAILED_FINAL` is set when attempts are exhausted or the error is permanent (suppression, validation, revoked credential). BullMQ dead-letter id is stored on the run's `error_code` / outcome, not as the only copy.

## 7. Integrations and audit

| Table | Notes |
|---|---|
| `integrations` | `kind`, `provider`, `external_account_id`, `credentials_ciphertext`, `key_id`, `status` (`PENDING`, `UNVERIFIED`, `CONNECTED`, `ERROR`, `DISABLED`), `config` JSONB for non-secret fields. Unique `(tenant_id, kind, external_account_id)`. |
| `integration_tests` | **Added.** Each simulated "Test connection" becomes a row: `status`, `error_code`, `started_at`, `finished_at`. No secrets in the error text. |
| `provider_event_receipts` | Unique `(tenant_id, provider, provider_event_id)`. |
| `webhook_endpoints` | **Added.** `url`, `event_types`, `secret_ciphertext`, `enabled`, `status`. URL must be `https`. |
| `webhook_deliveries` | **Added.** `endpoint_id`, `event_id`, `attempt`, `response_status`, `status`. |
| `identity_providers` | **Added for Phase 9.** `protocol` `OIDC` or `SAML`, `status` `DRAFT` / `DISABLED` / `VERIFIED`, issuer, client id, encrypted client secret, domain. `VERIFIED` only after a real test. |
| `audit_events` | Append-only for `salesos_app` (grant `INSERT` and `SELECT`, no `UPDATE` or `DELETE`). `actor_type`, `actor_id`, `action`, `entity_type`, `entity_id`, `payload` JSONB. Payload is redacted. |
| `outbox_events` | `event_type`, `schema_version`, `aggregate_id`, `payload`, `status`, `attempts`, `processed_at`. |
| `idempotency_keys` | PK `(tenant_id, key)`, `route`, `request_hash`, `response`. Same key with a different hash returns 409. |

`integrations.config` is a validated manifest per provider (the nine prototype connectors). Secret field names from the manifest are rejected if they appear in `config`. They belong in `credentials_ciphertext`.

Audit partitions by month can wait until volume requires them. The grant restriction cannot wait.

## 8. Indexes

Ship with the first migration, from the reference plus the new tables:

- `leads (tenant_id, campaign_id, state)`
- `leads (tenant_id, owner_user_id, state)`
- `messages (tenant_id, conversation_id, created_at desc)`
- `outbox_events (status, created_at)` where `status = 'PENDING'`
- `agent_actions (tenant_id, state, due_at)`
- `agent_runs (tenant_id, state, created_at desc)`
- `sales_tasks (tenant_id, status, due_at)`
- `meeting_artifacts (tenant_id, meeting_id)`
- `audit_events (tenant_id, created_at desc)`
- `llm_usage (tenant_id, created_at desc)`
- `sessions (user_id, revoked_at, expires_at)`

Add indexes only with an `EXPLAIN` on the pilot shape (NFR-07: 2 tenants, 10 users, 10k accounts, 1k threads). Do not index every JSONB path in MVP.

## 9. Events

Outbox payload is the BRD envelope: `eventId`, `eventType`, `schemaVersion`, `tenantId`, `aggregateId`, `occurredAt`, `actor`, `correlationId`, `causationId`, `payload`.

Minimum event types: `account.discovered.v1`, `lead.scored.v1`, `draft.approved.v1`, `message.queued.v1`, `message.sent.v1`, `message.received.v1`, `contact.opted_out.v1`, `lead.sales_ready.v1`, `meeting.confirmed.v1`, `conversation.human_taken_over.v1`, `agent.action_proposed.v1`, `automation.paused.v1`, `transcript.ready.v1`.

Payloads carry ids. Workers load bodies under RLS. A job that contains a message body is a defect.

## 10. Retention

Defaults, subject to counsel review (BRD §16.3):

| Data | Default |
|---|---|
| Unqualified research evidence | 90 days |
| Inactive conversation bodies | 12 months |
| Suppression hash | Kept as long as needed to honor the objection |
| Audit | 12 months, then archive. Not silently deleted if a legal hold exists. |
| Transcripts | Tenant setting, proposal 90 days, separate from notes. |

Deletion workflow writes an audit event, removes primary ciphertext, and enqueues derivative cleanup (chunks, storage objects, webhook payloads). Suppression rows remain.

## 11. Seed data

Development seed creates two tenants with unrelated products (BRD AT-18). Names are obviously fake. Code Colonies may exist as an optional third seed behind a flag for the founder's pilot. It is not the only seed, and no query special-cases its slug.

The current `components/data.js` companies move into `packages/database/fixtures/demo` for demo mode only. API mode tests use factories, not those companies.

## 12. Prisma operating notes

- Models use `@@id([tenantId, id])` for tenant tables.
- A repository helper `withTenant(tenantId, fn)` is the only supported way to query tenant data.
- CI migration test boots Postgres, applies Prisma migrations and the RLS SQL, then asserts every tenant table has `relrowsecurity` and `relforcerowsecurity`.
- A second test connects as `salesos_app`, omits `app.tenant_id`, and expects zero lead rows.
- A third test sets tenant A and requests an id from tenant B and expects zero rows.

No migration in this repository is approved until those three tests exist. The reference `schema.sql` may be used as the starting DDL review, then folded into versioned migrations. It is not executed by hand against production.
