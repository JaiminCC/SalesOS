-- Mailbox connections, messages, drafts, approvals, and capture delivery.
-- Live provider sending is not granted here.
-- Recovery: drop the mailbox_* tables and the two lookup functions in reverse dependency order.

CREATE TABLE public.mailbox_connections (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  provider_mailbox_id text NOT NULL,
  address text NOT NULL,
  connected_by uuid NOT NULL,
  scopes jsonb NOT NULL DEFAULT '[]',
  access_token_ciphertext bytea,
  refresh_token_ciphertext bytea,
  token_expires_at timestamptz,
  status text NOT NULL,
  last_sync_at timestamptz,
  last_error text,
  sending_enabled boolean NOT NULL DEFAULT false,
  live boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, provider, provider_mailbox_id)
);

CREATE TABLE public.mailbox_access (
  tenant_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  user_id uuid NOT NULL,
  access_role text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, connection_id, user_id),
  FOREIGN KEY (tenant_id, connection_id) REFERENCES public.mailbox_connections (tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE public.mailbox_oauth_states (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  state_hash text NOT NULL,
  provider text NOT NULL,
  verifier_ciphertext bytea NOT NULL,
  redirect_uri text NOT NULL,
  created_by uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (state_hash)
);

CREATE TABLE public.mailbox_sync_cursors (
  tenant_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  cursor text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, connection_id),
  FOREIGN KEY (tenant_id, connection_id) REFERENCES public.mailbox_connections (tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE public.mailbox_threads (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL,
  provider_thread_id text NOT NULL,
  subject text NOT NULL DEFAULT '',
  participants jsonb NOT NULL DEFAULT '[]',
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  unread_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'OPEN',
  classification text,
  owner_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, connection_id, provider_thread_id),
  FOREIGN KEY (tenant_id, connection_id) REFERENCES public.mailbox_connections (tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE public.mailbox_messages (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL,
  thread_id uuid NOT NULL,
  provider_message_id text NOT NULL,
  internet_message_id text,
  in_reply_to text,
  references_header text,
  direction text NOT NULL,
  folder text NOT NULL DEFAULT 'INBOX',
  sender text NOT NULL,
  recipients jsonb NOT NULL DEFAULT '[]',
  subject text NOT NULL DEFAULT '',
  text_body text NOT NULL DEFAULT '',
  html_safe text NOT NULL DEFAULT '',
  received_at timestamptz NOT NULL DEFAULT now(),
  provenance text NOT NULL,
  size_bytes integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, connection_id, provider_message_id),
  FOREIGN KEY (tenant_id, thread_id) REFERENCES public.mailbox_threads (tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE public.mailbox_attachments (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL,
  file_name text NOT NULL,
  content_type text NOT NULL,
  size_bytes integer NOT NULL,
  sha256 text NOT NULL,
  blocked boolean NOT NULL DEFAULT false,
  content_ciphertext bytea,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, message_id) REFERENCES public.mailbox_messages (tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE public.mailbox_thread_links (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL,
  subject_type text NOT NULL,
  subject_id uuid NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, thread_id, subject_type, subject_id),
  FOREIGN KEY (tenant_id, thread_id) REFERENCES public.mailbox_threads (tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE public.mailbox_ai_analyses (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL,
  run_id uuid,
  summary text NOT NULL,
  intent text NOT NULL,
  signals jsonb NOT NULL DEFAULT '{}',
  model_provider text,
  model_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, thread_id) REFERENCES public.mailbox_threads (tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE public.mailbox_drafts (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL,
  thread_id uuid,
  subject text NOT NULL DEFAULT '',
  body text NOT NULL DEFAULT '',
  recipients jsonb NOT NULL DEFAULT '[]',
  status text NOT NULL DEFAULT 'DRAFT',
  current_version integer NOT NULL DEFAULT 1,
  ai_generated boolean NOT NULL DEFAULT false,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, connection_id) REFERENCES public.mailbox_connections (tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE public.mailbox_draft_versions (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  draft_id uuid NOT NULL,
  version integer NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  recipients jsonb NOT NULL,
  body_sha256 text NOT NULL,
  ai_generated boolean NOT NULL DEFAULT false,
  run_id uuid,
  product_version_id uuid,
  citations jsonb NOT NULL DEFAULT '[]',
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, draft_id, version),
  FOREIGN KEY (tenant_id, draft_id) REFERENCES public.mailbox_drafts (tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE public.mailbox_approvals (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  draft_version_id uuid NOT NULL,
  decision text NOT NULL,
  decided_by uuid,
  payload_sha256 text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, draft_version_id) REFERENCES public.mailbox_draft_versions (tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE public.mailbox_send_attempts (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  draft_version_id uuid NOT NULL,
  approval_id uuid,
  connection_id uuid NOT NULL,
  state text NOT NULL,
  provider text NOT NULL,
  provider_request_id text,
  provider_message_id text,
  failure_reason text,
  reconciliation text,
  sent boolean NOT NULL DEFAULT false,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (tenant_id, draft_version_id) REFERENCES public.mailbox_draft_versions (tenant_id, id)
);

CREATE TABLE public.mailbox_delivery_events (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  attempt_id uuid NOT NULL,
  kind text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, attempt_id) REFERENCES public.mailbox_send_attempts (tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE public.mailbox_sync_events (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL,
  status text NOT NULL,
  detail text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE public.mailbox_webhook_receipts (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL,
  provider text NOT NULL,
  event_id text NOT NULL,
  payload_sha256 text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, provider, event_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.mailbox_connections, public.mailbox_access, public.mailbox_oauth_states, public.mailbox_sync_cursors,
  public.mailbox_threads, public.mailbox_messages, public.mailbox_attachments, public.mailbox_thread_links,
  public.mailbox_ai_analyses, public.mailbox_drafts, public.mailbox_draft_versions, public.mailbox_approvals,
  public.mailbox_send_attempts, public.mailbox_delivery_events, public.mailbox_sync_events, public.mailbox_webhook_receipts
TO salesos_app, salesos_worker;

GRANT SELECT ON TABLE public.mailbox_oauth_states TO salesos_directory;

DO $body$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'mailbox_connections','mailbox_access','mailbox_oauth_states','mailbox_sync_cursors','mailbox_threads',
    'mailbox_messages','mailbox_attachments','mailbox_thread_links','mailbox_ai_analyses','mailbox_drafts',
    'mailbox_draft_versions','mailbox_approvals','mailbox_send_attempts','mailbox_delivery_events',
    'mailbox_sync_events','mailbox_webhook_receipts'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON public.%I USING (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid) WITH CHECK (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)',
      table_name
    );
  END LOOP;
END
$body$;

CREATE OR REPLACE FUNCTION public.lookup_mailbox_oauth_state(target_hash text)
RETURNS TABLE (
  tenant_id uuid,
  id uuid,
  provider text,
  verifier_ciphertext bytea,
  redirect_uri text,
  created_by uuid,
  expires_at timestamptz,
  consumed_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $body$
  SELECT state.tenant_id, state.id, state.provider, state.verifier_ciphertext, state.redirect_uri,
         state.created_by, state.expires_at, state.consumed_at
  FROM public.mailbox_oauth_states AS state
  WHERE state.state_hash = target_hash
  LIMIT 1;
$body$;

ALTER FUNCTION public.lookup_mailbox_oauth_state(text) OWNER TO salesos_directory;
REVOKE ALL ON FUNCTION public.lookup_mailbox_oauth_state(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lookup_mailbox_oauth_state(text) TO salesos_app;

INSERT INTO public.role_permissions (tenant_id, role_id, permission)
SELECT r.tenant_id, r.id, p.permission
FROM public.roles r
CROSS JOIN (VALUES
  ('mailbox.read'), ('mailbox.connect'), ('mailbox.draft'), ('mailbox.review'), ('mailbox.send')
) AS p(permission)
WHERE r.name IN ('OWNER', 'ADMIN', 'Owner', 'Admin')
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (tenant_id, role_id, permission)
SELECT r.tenant_id, r.id, p.permission
FROM public.roles r
CROSS JOIN (VALUES ('mailbox.read'), ('mailbox.draft'), ('mailbox.review')) AS p(permission)
WHERE r.name IN ('SALES_MANAGER', 'Manager')
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (tenant_id, role_id, permission)
SELECT r.tenant_id, r.id, p.permission
FROM public.roles r
CROSS JOIN (VALUES ('mailbox.read'), ('mailbox.draft')) AS p(permission)
WHERE r.name IN ('SALES_AGENT', 'Sales')
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (tenant_id, role_id, permission)
SELECT r.tenant_id, r.id, p.permission
FROM public.roles r
CROSS JOIN (VALUES ('mailbox.read')) AS p(permission)
WHERE r.name IN ('VIEWER', 'Analyst')
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (tenant_id, role_id, permission)
SELECT r.tenant_id, r.id, p.permission
FROM public.roles r
CROSS JOIN (VALUES ('mailbox.read'), ('mailbox.review')) AS p(permission)
WHERE r.name = 'Reviewer'
ON CONFLICT DO NOTHING;
