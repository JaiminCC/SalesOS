-- WhatsApp Business foundation. Outbound delivery stays unauthorized.
-- Recovery: drop the new tables in reverse dependency order, then drop resolve_whatsapp_phone.

CREATE TABLE public.whatsapp_connections (
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  display_name text NOT NULL,
  mode text NOT NULL,
  waba_id text NOT NULL,
  readiness text NOT NULL,
  outbound_enabled boolean NOT NULL DEFAULT false,
  disabled_at timestamptz,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT whatsapp_connections_mode_check CHECK (mode IN ('MANUAL', 'EMBEDDED')),
  CONSTRAINT whatsapp_connections_outbound_check CHECK (outbound_enabled = false),
  CONSTRAINT whatsapp_connections_readiness_check CHECK (readiness IN (
    'NOT_CONFIGURED', 'CONFIGURATION_INVALID', 'CONFIGURED_UNVERIFIED', 'AUTHORIZATION_REQUIRED',
    'WEBHOOK_SETUP_REQUIRED', 'PHONE_VERIFICATION_REQUIRED', 'READY_FOR_READ_VALIDATION',
    'LIVE_INBOUND_VERIFIED', 'DEGRADED', 'DISCONNECTED'
  ))
);

CREATE TABLE public.whatsapp_phone_numbers (
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL,
  waba_id text NOT NULL,
  provider_phone_id text NOT NULL,
  display_number text NOT NULL,
  display_name text NOT NULL DEFAULT '',
  verification_state text NOT NULL,
  quality text NOT NULL DEFAULT 'UNKNOWN',
  inbound_enabled boolean NOT NULL DEFAULT true,
  outbound_enabled boolean NOT NULL DEFAULT false,
  health text NOT NULL DEFAULT 'UNKNOWN',
  last_verified_at timestamptz,
  last_webhook_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, connection_id) REFERENCES public.whatsapp_connections (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT whatsapp_phone_outbound_check CHECK (outbound_enabled = false),
  CONSTRAINT whatsapp_phone_verification_check CHECK (verification_state IN ('UNVERIFIED', 'PROVIDER_UNVERIFIED', 'VERIFIED'))
);

CREATE UNIQUE INDEX whatsapp_phone_numbers_provider_phone_id_key
  ON public.whatsapp_phone_numbers (provider_phone_id);

CREATE TABLE public.whatsapp_credentials (
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL,
  ciphertext bytea NOT NULL,
  hint text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, connection_id) REFERENCES public.whatsapp_connections (tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE public.whatsapp_conversations (
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  phone_id uuid NOT NULL,
  customer_e164 text NOT NULL,
  state text NOT NULL,
  unread_count integer NOT NULL DEFAULT 0,
  last_inbound_at timestamptz,
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  window_state text NOT NULL,
  ai_enabled boolean NOT NULL DEFAULT true,
  intent text NOT NULL DEFAULT 'UNKNOWN',
  assignee_id uuid,
  contact_id uuid,
  lead_id uuid,
  takeover boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, phone_id) REFERENCES public.whatsapp_phone_numbers (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT whatsapp_conversations_state_check CHECK (state IN (
    'OPEN', 'AI_REVIEW', 'HUMAN_ASSIGNED', 'WAITING_CUSTOMER', 'RESOLVED', 'CLOSED', 'BLOCKED'
  )),
  CONSTRAINT whatsapp_conversations_window_check CHECK (window_state IN ('WINDOW_OPEN', 'WINDOW_CLOSED', 'WINDOW_UNKNOWN'))
);

CREATE UNIQUE INDEX whatsapp_conversations_customer_key
  ON public.whatsapp_conversations (tenant_id, phone_id, customer_e164);

CREATE TABLE public.whatsapp_messages (
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL,
  provider_message_id text NOT NULL,
  direction text NOT NULL,
  message_type text NOT NULL,
  body text,
  reply_to text,
  provider_timestamp timestamptz NOT NULL,
  origin text NOT NULL,
  processing_status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, conversation_id) REFERENCES public.whatsapp_conversations (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT whatsapp_messages_direction_check CHECK (direction = 'INBOUND'),
  CONSTRAINT whatsapp_messages_origin_check CHECK (origin IN ('STUB_TESTED', 'LOCAL_CAPTURE'))
);

CREATE UNIQUE INDEX whatsapp_messages_provider_key
  ON public.whatsapp_messages (tenant_id, provider_message_id);

CREATE TABLE public.whatsapp_message_statuses (
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  provider_message_id text NOT NULL,
  provider_status text NOT NULL,
  provider_timestamp timestamptz NOT NULL,
  origin text NOT NULL,
  matched boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT whatsapp_status_origin_check CHECK (origin IN ('STUB_TESTED', 'LOCAL_CAPTURE')),
  CONSTRAINT whatsapp_status_value_check CHECK (provider_status IN ('sent', 'delivered', 'read', 'failed'))
);

CREATE UNIQUE INDEX whatsapp_message_statuses_event_key
  ON public.whatsapp_message_statuses (tenant_id, provider_message_id, provider_status);

CREATE TABLE public.whatsapp_contact_links (
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL,
  contact_id uuid,
  lead_id uuid,
  state text NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, conversation_id) REFERENCES public.whatsapp_conversations (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT whatsapp_contact_link_state_check CHECK (state IN ('LINKED', 'REVIEW_REQUIRED', 'UNKNOWN'))
);

CREATE TABLE public.whatsapp_consents (
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  phone_id uuid NOT NULL,
  customer_e164 text NOT NULL,
  purpose text NOT NULL,
  status text NOT NULL,
  source text NOT NULL,
  evidence text NOT NULL DEFAULT '',
  actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, phone_id) REFERENCES public.whatsapp_phone_numbers (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT whatsapp_consents_status_check CHECK (status IN ('UNKNOWN', 'OPT_IN', 'OPT_OUT')),
  CONSTRAINT whatsapp_consents_purpose_check CHECK (purpose IN ('INBOUND_INTERACTION', 'PROMOTIONAL', 'TRANSACTIONAL'))
);

CREATE TABLE public.whatsapp_templates (
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  language text NOT NULL,
  category text NOT NULL,
  archived_at timestamptz,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT whatsapp_templates_category_check CHECK (category IN ('MARKETING', 'UTILITY', 'AUTHENTICATION'))
);

CREATE TABLE public.whatsapp_template_versions (
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL,
  version_number integer NOT NULL,
  body text NOT NULL,
  variables jsonb NOT NULL DEFAULT '[]',
  local_status text NOT NULL,
  provider_status text NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, template_id) REFERENCES public.whatsapp_templates (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT whatsapp_template_local_check CHECK (local_status IN ('LOCAL_DRAFT', 'READY_FOR_SUBMISSION', 'SUBMISSION_BLOCKED')),
  CONSTRAINT whatsapp_template_provider_check CHECK (provider_status IN (
    'PROVIDER_PENDING', 'PROVIDER_REJECTED', 'PROVIDER_PAUSED', 'PROVIDER_DISABLED', 'PROVIDER_UNKNOWN'
  ))
);

CREATE UNIQUE INDEX whatsapp_template_versions_number_key
  ON public.whatsapp_template_versions (tenant_id, template_id, version_number);

CREATE TABLE public.whatsapp_drafts (
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL,
  source_message_id uuid,
  status text NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, conversation_id) REFERENCES public.whatsapp_conversations (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT whatsapp_drafts_status_check CHECK (status IN ('AWAITING_REVIEW', 'BLOCKED', 'APPROVED', 'REJECTED'))
);

CREATE UNIQUE INDEX whatsapp_drafts_source_key
  ON public.whatsapp_drafts (tenant_id, source_message_id)
  WHERE source_message_id IS NOT NULL;

CREATE TABLE public.whatsapp_draft_versions (
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  draft_id uuid NOT NULL,
  version_number integer NOT NULL,
  body text NOT NULL,
  source text NOT NULL,
  model_name text,
  risk text NOT NULL DEFAULT 'REVIEW',
  digest text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, draft_id) REFERENCES public.whatsapp_drafts (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT whatsapp_draft_source_check CHECK (source IN ('DETERMINISTIC', 'MODEL', 'HUMAN_EDIT'))
);

CREATE UNIQUE INDEX whatsapp_draft_versions_number_key
  ON public.whatsapp_draft_versions (tenant_id, draft_id, version_number);

CREATE TABLE public.whatsapp_approvals (
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  draft_version_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  recipient text NOT NULL,
  digest text NOT NULL,
  decision text NOT NULL,
  reviewer_id uuid NOT NULL,
  consent_status text NOT NULL,
  window_state text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, draft_version_id) REFERENCES public.whatsapp_draft_versions (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT whatsapp_approvals_decision_check CHECK (decision IN ('APPROVED', 'REJECTED'))
);

CREATE TABLE public.whatsapp_assignments (
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL,
  assignee_id uuid,
  action text NOT NULL,
  reason text NOT NULL DEFAULT '',
  actor_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, conversation_id) REFERENCES public.whatsapp_conversations (tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE public.whatsapp_alerts (
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  code text NOT NULL,
  summary text NOT NULL,
  dedupe_key text NOT NULL,
  acknowledged_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);

CREATE UNIQUE INDEX whatsapp_alerts_dedupe_key
  ON public.whatsapp_alerts (tenant_id, dedupe_key);

CREATE TABLE public.whatsapp_provider_errors (
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  code text NOT NULL,
  summary text NOT NULL,
  provider_message_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE public.whatsapp_verifications (
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL,
  evidence text NOT NULL,
  origin text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, connection_id) REFERENCES public.whatsapp_connections (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT whatsapp_verifications_origin_check CHECK (origin IN ('STUB_TESTED', 'LOCAL_CAPTURE'))
);

CREATE TABLE public.whatsapp_webhook_receipts (
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  event_key text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL,
  origin text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT whatsapp_receipts_origin_check CHECK (origin IN ('STUB_TESTED', 'LOCAL_CAPTURE')),
  CONSTRAINT whatsapp_receipts_status_check CHECK (status IN ('RECEIVED', 'PROCESSED'))
);

CREATE UNIQUE INDEX whatsapp_webhook_receipts_event_key
  ON public.whatsapp_webhook_receipts (tenant_id, event_key);

CREATE TABLE public.whatsapp_ingress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key text NOT NULL UNIQUE,
  provider_phone_id text NOT NULL,
  kind text NOT NULL,
  status text NOT NULL,
  origin text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT whatsapp_ingress_origin_check CHECK (origin IN ('STUB_TESTED', 'LOCAL_CAPTURE')),
  CONSTRAINT whatsapp_ingress_status_check CHECK (status IN ('RECEIVED', 'PROCESSED', 'QUARANTINED', 'DISABLED'))
);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.whatsapp_connections,
  public.whatsapp_phone_numbers,
  public.whatsapp_credentials,
  public.whatsapp_conversations,
  public.whatsapp_messages,
  public.whatsapp_message_statuses,
  public.whatsapp_contact_links,
  public.whatsapp_consents,
  public.whatsapp_templates,
  public.whatsapp_template_versions,
  public.whatsapp_drafts,
  public.whatsapp_draft_versions,
  public.whatsapp_approvals,
  public.whatsapp_assignments,
  public.whatsapp_alerts,
  public.whatsapp_provider_errors,
  public.whatsapp_verifications,
  public.whatsapp_webhook_receipts
TO salesos_app, salesos_worker;

GRANT SELECT, INSERT, UPDATE ON TABLE public.whatsapp_ingress TO salesos_app, salesos_worker;
GRANT SELECT ON TABLE public.whatsapp_phone_numbers TO salesos_directory;

DO $$
DECLARE name text;
BEGIN
  FOREACH name IN ARRAY ARRAY[
    'whatsapp_connections', 'whatsapp_phone_numbers', 'whatsapp_credentials', 'whatsapp_conversations',
    'whatsapp_messages', 'whatsapp_message_statuses', 'whatsapp_contact_links', 'whatsapp_consents',
    'whatsapp_templates', 'whatsapp_template_versions', 'whatsapp_drafts', 'whatsapp_draft_versions',
    'whatsapp_approvals', 'whatsapp_assignments', 'whatsapp_alerts', 'whatsapp_provider_errors',
    'whatsapp_verifications', 'whatsapp_webhook_receipts'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', name);
    EXECUTE format('CREATE POLICY tenant_isolation ON public.%I USING (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid) WITH CHECK (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)', name);
  END LOOP;
END $$;

CREATE FUNCTION public.resolve_whatsapp_phone(phone text)
RETURNS TABLE (tenant_id uuid, connection_id uuid, phone_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $body$
  SELECT p.tenant_id, p.connection_id, p.id
  FROM public.whatsapp_phone_numbers AS p
  JOIN public.whatsapp_connections AS c
    ON c.tenant_id = p.tenant_id
   AND c.id = p.connection_id
  WHERE p.provider_phone_id = phone
    AND p.inbound_enabled = true
    AND c.disabled_at IS NULL
  LIMIT 1
$body$;

ALTER FUNCTION public.resolve_whatsapp_phone(text) OWNER TO salesos_directory;
REVOKE ALL ON FUNCTION public.resolve_whatsapp_phone(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_whatsapp_phone(text) TO salesos_app, salesos_worker;

INSERT INTO public.role_permissions (tenant_id, role_id, permission)
SELECT r.tenant_id, r.id, p.permission
FROM public.roles r
CROSS JOIN (VALUES
  ('whatsapp.connections.read'), ('whatsapp.connections.manage'),
  ('whatsapp.conversations.read'), ('whatsapp.conversations.manage'),
  ('whatsapp.messages.read'), ('whatsapp.drafts.create'), ('whatsapp.drafts.review'),
  ('whatsapp.templates.read'), ('whatsapp.templates.manage'),
  ('whatsapp.consent.manage'), ('whatsapp.operations.read'), ('whatsapp.operations.manage')
) AS p(permission)
WHERE r.name IN ('OWNER', 'ADMIN', 'Owner', 'Admin')
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (tenant_id, role_id, permission)
SELECT r.tenant_id, r.id, p.permission
FROM public.roles r
CROSS JOIN (VALUES
  ('whatsapp.connections.read'), ('whatsapp.connections.manage'),
  ('whatsapp.conversations.read'), ('whatsapp.conversations.manage'),
  ('whatsapp.messages.read'), ('whatsapp.drafts.create'),
  ('whatsapp.templates.read'), ('whatsapp.templates.manage'),
  ('whatsapp.consent.manage'), ('whatsapp.operations.read')
) AS p(permission)
WHERE r.name IN ('SALES_MANAGER', 'Manager')
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (tenant_id, role_id, permission)
SELECT r.tenant_id, r.id, p.permission
FROM public.roles r
CROSS JOIN (VALUES
  ('whatsapp.conversations.read'), ('whatsapp.messages.read'), ('whatsapp.drafts.review'), ('whatsapp.operations.read')
) AS p(permission)
WHERE r.name = 'Reviewer'
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (tenant_id, role_id, permission)
SELECT r.tenant_id, r.id, p.permission
FROM public.roles r
CROSS JOIN (VALUES
  ('whatsapp.conversations.read'), ('whatsapp.templates.read'), ('whatsapp.operations.read')
) AS p(permission)
WHERE r.name IN ('Analyst', 'VIEWER')
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (tenant_id, role_id, permission)
SELECT r.tenant_id, r.id, p.permission
FROM public.roles r
CROSS JOIN (VALUES
  ('whatsapp.conversations.read'), ('whatsapp.messages.read'), ('whatsapp.drafts.create')
) AS p(permission)
WHERE r.name IN ('Sales', 'SALES_AGENT')
ON CONFLICT DO NOTHING;
