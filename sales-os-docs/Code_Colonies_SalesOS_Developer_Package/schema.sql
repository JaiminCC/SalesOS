-- SalesOS v1 PostgreSQL 16+ REFERENCE SCHEMA. Review and convert to versioned migrations.
-- Security: connect application as non-owner role WITHOUT BYPASSRLS.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE tenants (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, slug text UNIQUE NOT NULL, status text NOT NULL DEFAULT 'ACTIVE', settings jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text UNIQUE NOT NULL, password_hash text, display_name text NOT NULL, mfa_enabled boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE memberships (tenant_id uuid NOT NULL REFERENCES tenants(id), user_id uuid NOT NULL REFERENCES users(id), role text NOT NULL CHECK(role IN ('ADMIN','PRODUCT_MANAGER','SALES_MANAGER','SALES_REP','REVIEWER')), status text NOT NULL DEFAULT 'ACTIVE', PRIMARY KEY(tenant_id,user_id));
CREATE TABLE products (tenant_id uuid NOT NULL REFERENCES tenants(id), id uuid NOT NULL DEFAULT gen_random_uuid(), name text NOT NULL, type text NOT NULL, status text NOT NULL DEFAULT 'DRAFT', created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,id));
CREATE TABLE product_versions (tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), product_id uuid NOT NULL, version int NOT NULL, published boolean NOT NULL DEFAULT false, icp jsonb NOT NULL DEFAULT '{}', approved_facts jsonb NOT NULL DEFAULT '[]', qualification_schema jsonb NOT NULL DEFAULT '{}', restrictions jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,product_id,version), FOREIGN KEY(tenant_id,product_id) REFERENCES products(tenant_id,id));
CREATE TABLE knowledge_documents (tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), product_id uuid NOT NULL, source_name text NOT NULL, sha256 text NOT NULL, storage_key text NOT NULL, status text NOT NULL DEFAULT 'PENDING', approved_by uuid, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,id), FOREIGN KEY(tenant_id,product_id) REFERENCES products(tenant_id,id));
CREATE TABLE knowledge_chunks (tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), document_id uuid NOT NULL, chunk_index int NOT NULL, content text NOT NULL, metadata jsonb NOT NULL DEFAULT '{}', PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,document_id,chunk_index), FOREIGN KEY(tenant_id,document_id) REFERENCES knowledge_documents(tenant_id,id));
CREATE TABLE accounts (tenant_id uuid NOT NULL REFERENCES tenants(id), id uuid NOT NULL DEFAULT gen_random_uuid(), name text NOT NULL, normalized_domain text, country_code char(2), industry text, status text NOT NULL DEFAULT 'DISCOVERED', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version int NOT NULL DEFAULT 1, PRIMARY KEY(tenant_id,id));
CREATE UNIQUE INDEX ux_accounts_domain ON accounts(tenant_id,normalized_domain) WHERE normalized_domain IS NOT NULL;
CREATE TABLE contacts (tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), account_id uuid NOT NULL, full_name text, title text, email_ciphertext bytea, email_hmac text, source_legal_status text NOT NULL DEFAULT 'REVIEW', status text NOT NULL DEFAULT 'UNVERIFIED', created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,id), FOREIGN KEY(tenant_id,account_id) REFERENCES accounts(tenant_id,id));
CREATE UNIQUE INDEX ux_contacts_email_hmac ON contacts(tenant_id,email_hmac) WHERE email_hmac IS NOT NULL;
CREATE TABLE source_evidence (tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), account_id uuid NOT NULL, source_url text NOT NULL, source_url_hash text NOT NULL, excerpt text NOT NULL, source_type text NOT NULL, license_status text NOT NULL DEFAULT 'REVIEW', observed_at timestamptz NOT NULL, expires_at timestamptz, confidence numeric(5,4), PRIMARY KEY(tenant_id,id), FOREIGN KEY(tenant_id,account_id) REFERENCES accounts(tenant_id,id));
CREATE TABLE campaigns (tenant_id uuid NOT NULL REFERENCES tenants(id), id uuid NOT NULL DEFAULT gen_random_uuid(), name text NOT NULL, status text NOT NULL DEFAULT 'DRAFT', config jsonb NOT NULL DEFAULT '{}', owner_user_id uuid, daily_send_cap int NOT NULL DEFAULT 20 CHECK(daily_send_cap BETWEEN 0 AND 1000), approval_mode text NOT NULL DEFAULT 'FIRST_CONTACT_REQUIRED', version int NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,id));
CREATE TABLE campaign_products (tenant_id uuid NOT NULL, campaign_id uuid NOT NULL, product_version_id uuid NOT NULL, PRIMARY KEY(tenant_id,campaign_id,product_version_id), FOREIGN KEY(tenant_id,campaign_id) REFERENCES campaigns(tenant_id,id), FOREIGN KEY(tenant_id,product_version_id) REFERENCES product_versions(tenant_id,id));
CREATE TABLE leads (tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), campaign_id uuid NOT NULL, account_id uuid NOT NULL, contact_id uuid, state text NOT NULL DEFAULT 'DISCOVERED', score int CHECK(score BETWEEN 0 AND 100), score_reasons jsonb NOT NULL DEFAULT '[]', owner_user_id uuid, version int NOT NULL DEFAULT 1, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,id), FOREIGN KEY(tenant_id,campaign_id) REFERENCES campaigns(tenant_id,id), FOREIGN KEY(tenant_id,account_id) REFERENCES accounts(tenant_id,id), FOREIGN KEY(tenant_id,contact_id) REFERENCES contacts(tenant_id,id));
CREATE TABLE conversations (tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), lead_id uuid NOT NULL, channel text NOT NULL DEFAULT 'EMAIL', state text NOT NULL DEFAULT 'NEW', human_owned boolean NOT NULL DEFAULT false, provider_thread_id text, version int NOT NULL DEFAULT 1, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,id), FOREIGN KEY(tenant_id,lead_id) REFERENCES leads(tenant_id,id));
CREATE TABLE messages (tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), conversation_id uuid NOT NULL, provider text NOT NULL, provider_message_id text, direction text NOT NULL CHECK(direction IN ('INBOUND','OUTBOUND')), body_ciphertext bytea, status text NOT NULL, source_evidence_ids uuid[] NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,id), FOREIGN KEY(tenant_id,conversation_id) REFERENCES conversations(tenant_id,id));
CREATE UNIQUE INDEX ux_messages_provider ON messages(tenant_id,provider,provider_message_id) WHERE provider_message_id IS NOT NULL;
CREATE TABLE outreach_drafts (tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), lead_id uuid NOT NULL, subject text NOT NULL, body text NOT NULL, status text NOT NULL DEFAULT 'DRAFT', approved_by uuid, approved_at timestamptz, facts jsonb NOT NULL DEFAULT '[]', version int NOT NULL DEFAULT 1, PRIMARY KEY(tenant_id,id), FOREIGN KEY(tenant_id,lead_id) REFERENCES leads(tenant_id,id));
CREATE TABLE qualification_answers (tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), lead_id uuid NOT NULL, field_key text NOT NULL, value jsonb NOT NULL, source_message_id uuid, confidence numeric(5,4), PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,lead_id,field_key), FOREIGN KEY(tenant_id,lead_id) REFERENCES leads(tenant_id,id), FOREIGN KEY(tenant_id,source_message_id) REFERENCES messages(tenant_id,id));
CREATE TABLE opportunities (tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), lead_id uuid NOT NULL, stage text NOT NULL DEFAULT 'QUALIFYING', estimated_value_minor bigint, currency char(3), next_action_at timestamptz, owner_user_id uuid, PRIMARY KEY(tenant_id,id), FOREIGN KEY(tenant_id,lead_id) REFERENCES leads(tenant_id,id));
CREATE TABLE meetings (tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), conversation_id uuid NOT NULL, status text NOT NULL DEFAULT 'PROPOSED', starts_at timestamptz, ends_at timestamptz, timezone text, provider_event_id text, buyer_confirmed_at timestamptz, PRIMARY KEY(tenant_id,id), FOREIGN KEY(tenant_id,conversation_id) REFERENCES conversations(tenant_id,id));
CREATE TABLE integrations (tenant_id uuid NOT NULL REFERENCES tenants(id), id uuid NOT NULL DEFAULT gen_random_uuid(), kind text NOT NULL, provider text NOT NULL, external_account_id text NOT NULL, credentials_ciphertext bytea, status text NOT NULL DEFAULT 'PENDING', config jsonb NOT NULL DEFAULT '{}', PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,kind,external_account_id));
CREATE TABLE suppression_entries (tenant_id uuid NOT NULL REFERENCES tenants(id), id uuid NOT NULL DEFAULT gen_random_uuid(), contact_hash text NOT NULL, scope text NOT NULL DEFAULT 'ALL', reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,contact_hash,scope));
CREATE TABLE audit_events (tenant_id uuid NOT NULL REFERENCES tenants(id), id uuid NOT NULL DEFAULT gen_random_uuid(), actor_type text NOT NULL, actor_id text, action text NOT NULL, entity_type text NOT NULL, entity_id text NOT NULL, payload jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,id));
CREATE TABLE outbox_events (tenant_id uuid NOT NULL REFERENCES tenants(id), id uuid NOT NULL DEFAULT gen_random_uuid(), event_type text NOT NULL, schema_version int NOT NULL DEFAULT 1, aggregate_id uuid NOT NULL, payload jsonb NOT NULL, status text NOT NULL DEFAULT 'PENDING', attempts int NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(), processed_at timestamptz, PRIMARY KEY(tenant_id,id));
CREATE TABLE idempotency_keys (tenant_id uuid NOT NULL REFERENCES tenants(id), key text NOT NULL, route text NOT NULL, request_hash text NOT NULL, response jsonb, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,key));

-- DENY-BY-DEFAULT tenant policy. Ensure connection invokes BEGIN; SET LOCAL app.tenant_id=...; statements; COMMIT.
-- Missing tenant setting resolves to no rows (nullif(...,'')::uuid).
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['memberships','products','product_versions','knowledge_documents','knowledge_chunks','accounts','contacts','source_evidence','campaigns','campaign_products','leads','conversations','messages','outreach_drafts','qualification_answers','opportunities','meetings','integrations','suppression_entries','audit_events','outbox_events','idempotency_keys'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('CREATE POLICY tenant_isolation_%I ON %I USING (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid) WITH CHECK (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)', t,t);
  END LOOP;
END $$;

-- IMPORTANT: migrations run as owner, API runtime as non-owner least-privilege role.
-- Also implement per-record ABAC in NestJS for assignment/roles; RLS alone is insufficient.
-- Store encrypted email/token ciphertext using application encryption keys and deterministic HMAC for matching.
-- Add indexes based on EXPLAIN performance: lead state, campaign, messages by conversation and outbox status.
CREATE INDEX ix_leads_campaign_state ON leads(tenant_id,campaign_id,state);
CREATE INDEX ix_messages_conversation_time ON messages(tenant_id,conversation_id,created_at DESC);
CREATE INDEX ix_outbox_pending ON outbox_events(status,created_at) WHERE status='PENDING';

-- ============================================================
-- AI-first supervisor and meeting intelligence extension
-- Reference DDL only: production migrations and enum policies needed.
-- ============================================================
CREATE TABLE automation_policies (
 tenant_id uuid NOT NULL REFERENCES tenants(id), id uuid NOT NULL DEFAULT gen_random_uuid(),
 name text NOT NULL, status text NOT NULL DEFAULT 'ACTIVE',
 autonomy_level text NOT NULL CHECK(autonomy_level IN ('A0','A1','A2','A3','A4')),
 channel text, action_type text, constraints jsonb NOT NULL DEFAULT '{}',
 effective_at timestamptz NOT NULL DEFAULT now(), version int NOT NULL DEFAULT 1,
 PRIMARY KEY(tenant_id,id)
);
CREATE TABLE agent_runs (
 tenant_id uuid NOT NULL REFERENCES tenants(id), id uuid NOT NULL DEFAULT gen_random_uuid(),
 trigger_type text NOT NULL, source_event_id text, state text NOT NULL DEFAULT 'QUEUED',
 model_provider text, model_name text, input_redacted jsonb NOT NULL DEFAULT '{}',
 started_at timestamptz, finished_at timestamptz, error_code text,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,id)
);
CREATE TABLE agent_actions (
 tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
 run_id uuid NOT NULL, action_type text NOT NULL, target_type text NOT NULL,
 target_id uuid NOT NULL, source_event_id text, risk_level text NOT NULL,
 policy_version text, state text NOT NULL DEFAULT 'PROPOSED',
 requires_human_approval boolean NOT NULL DEFAULT true, approved_by uuid,
 due_at timestamptz, attempts int NOT NULL DEFAULT 0,
 idempotency_key text NOT NULL, payload jsonb NOT NULL DEFAULT '{}',
 outcome jsonb, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,idempotency_key),
 FOREIGN KEY(tenant_id,run_id) REFERENCES agent_runs(tenant_id,id)
);
CREATE TABLE sales_tasks (
 tenant_id uuid NOT NULL REFERENCES tenants(id), id uuid NOT NULL DEFAULT gen_random_uuid(),
 owner_user_id uuid, related_lead_id uuid, related_meeting_id uuid,
 source_event_id text, title text NOT NULL, description text,
 status text NOT NULL DEFAULT 'OPEN', priority text NOT NULL DEFAULT 'NORMAL',
 due_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 completed_at timestamptz, PRIMARY KEY(tenant_id,id),
 FOREIGN KEY(tenant_id,related_lead_id) REFERENCES leads(tenant_id,id),
 FOREIGN KEY(tenant_id,related_meeting_id) REFERENCES meetings(tenant_id,id)
);
CREATE TABLE meeting_artifacts (
 tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
 meeting_id uuid NOT NULL, artifact_type text NOT NULL,
 source text NOT NULL, provider_id text, storage_key text NOT NULL,
 sha256 text NOT NULL, consent_attested boolean NOT NULL DEFAULT false,
 consent_evidence text, language_code text, status text NOT NULL DEFAULT 'QUEUED',
 retention_until timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,meeting_id,sha256),
 FOREIGN KEY(tenant_id,meeting_id) REFERENCES meetings(tenant_id,id)
);
CREATE TABLE meeting_segments (
 tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
 artifact_id uuid NOT NULL, segment_index int NOT NULL,
 speaker_label text, start_ms bigint, end_ms bigint,
 text_ciphertext bytea NOT NULL, confidence numeric(5,4),
 PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,artifact_id,segment_index),
 FOREIGN KEY(tenant_id,artifact_id) REFERENCES meeting_artifacts(tenant_id,id)
);
CREATE TABLE meeting_notes (
 tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
 meeting_id uuid NOT NULL, source_artifact_id uuid NOT NULL,
 schema_version int NOT NULL DEFAULT 1, version int NOT NULL DEFAULT 1,
 note_json jsonb NOT NULL, review_status text NOT NULL DEFAULT 'DRAFT',
 generated_model text, generated_at timestamptz NOT NULL DEFAULT now(),
 reviewed_by uuid, reviewed_at timestamptz,
 PRIMARY KEY(tenant_id,id),
 FOREIGN KEY(tenant_id,meeting_id) REFERENCES meetings(tenant_id,id),
 FOREIGN KEY(tenant_id,source_artifact_id) REFERENCES meeting_artifacts(tenant_id,id)
);
CREATE TABLE meeting_action_items (
 tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
 note_id uuid NOT NULL, task_id uuid, description text NOT NULL,
 owner_user_id uuid, due_at timestamptz, confidence numeric(5,4),
 evidence_segment_ids uuid[] NOT NULL DEFAULT '{}',
 status text NOT NULL DEFAULT 'NEEDS_REVIEW',
 PRIMARY KEY(tenant_id,id),
 FOREIGN KEY(tenant_id,note_id) REFERENCES meeting_notes(tenant_id,id),
 FOREIGN KEY(tenant_id,task_id) REFERENCES sales_tasks(tenant_id,id)
);
CREATE TABLE provider_event_receipts (
 tenant_id uuid NOT NULL REFERENCES tenants(id), id uuid NOT NULL DEFAULT gen_random_uuid(),
 provider text NOT NULL, provider_event_id text NOT NULL,
 event_type text NOT NULL, received_at timestamptz NOT NULL DEFAULT now(),
 payload_hash text NOT NULL, processed_at timestamptz,
 PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,provider,provider_event_id)
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['automation_policies','agent_runs','agent_actions','sales_tasks',
 'meeting_artifacts','meeting_segments','meeting_notes','meeting_action_items','provider_event_receipts'] LOOP
   EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
   EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
   EXECUTE format('CREATE POLICY tenant_isolation_%I ON %I USING (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid) WITH CHECK (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)',t,t);
 END LOOP;
END $$;
CREATE INDEX ix_agent_actions_due ON agent_actions(tenant_id,state,due_at);
CREATE INDEX ix_sales_tasks_due ON sales_tasks(tenant_id,status,due_at);
CREATE INDEX ix_meeting_artifacts_meeting ON meeting_artifacts(tenant_id,meeting_id);
-- Important: cross-table evidence_segment_ids[] reference validation is application-level;
-- use a bridge table in production if strict foreign-key provenance is required.
