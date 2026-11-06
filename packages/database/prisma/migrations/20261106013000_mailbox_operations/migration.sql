-- Communication operations metadata. Live sending stays disabled.
-- Recovery: drop the new tables and columns in reverse order.

ALTER TABLE public.mailbox_connections
  ADD COLUMN health_state text NOT NULL DEFAULT 'NOT_CONFIGURED',
  ADD COLUMN sync_paused boolean NOT NULL DEFAULT false;

CREATE TABLE public.mailbox_health_events (
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL,
  provider text NOT NULL,
  previous_state text NOT NULL,
  next_state text NOT NULL,
  reason text NOT NULL,
  trace_id text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, connection_id) REFERENCES public.mailbox_connections (tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE public.mailbox_sync_runs (
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL,
  provider text NOT NULL,
  job_type text NOT NULL,
  trigger_source text NOT NULL,
  started_at timestamptz NOT NULL,
  finished_at timestamptz,
  worker_id text NOT NULL,
  lease_version integer NOT NULL DEFAULT 0,
  pages_fetched integer NOT NULL DEFAULT 0,
  inserted_count integer NOT NULL DEFAULT 0,
  updated_count integer NOT NULL DEFAULT 0,
  duplicates_skipped integer NOT NULL DEFAULT 0,
  cursor_before text NOT NULL DEFAULT 'none',
  cursor_after text NOT NULL DEFAULT 'none',
  retry_count integer NOT NULL DEFAULT 0,
  rate_limited boolean NOT NULL DEFAULT false,
  error_code text,
  state text NOT NULL,
  trace_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, connection_id) REFERENCES public.mailbox_connections (tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE public.mailbox_provider_errors (
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL,
  provider text NOT NULL,
  code text NOT NULL,
  http_status integer,
  retryable boolean NOT NULL,
  severity text NOT NULL,
  action text NOT NULL,
  trace_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, connection_id) REFERENCES public.mailbox_connections (tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE public.mailbox_operational_alerts (
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL,
  code text NOT NULL,
  severity text NOT NULL,
  state text NOT NULL DEFAULT 'OPEN',
  dedupe_key text NOT NULL,
  trace_id text NOT NULL,
  acknowledged_at timestamptz,
  acknowledged_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, dedupe_key),
  FOREIGN KEY (tenant_id, connection_id) REFERENCES public.mailbox_connections (tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE public.mailbox_provider_verifications (
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL,
  provider text NOT NULL,
  origin text NOT NULL,
  outcome text NOT NULL,
  read_scope text NOT NULL DEFAULT 'unknown',
  identity_matched boolean NOT NULL DEFAULT false,
  page_count integer NOT NULL DEFAULT 0,
  inserted_count integer NOT NULL DEFAULT 0,
  duplicate_count integer NOT NULL DEFAULT 0,
  cursor_changed boolean NOT NULL DEFAULT false,
  duration_ms integer NOT NULL DEFAULT 0,
  trace_id text NOT NULL,
  failure_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, connection_id) REFERENCES public.mailbox_connections (tenant_id, id) ON DELETE CASCADE
);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.mailbox_health_events,
  public.mailbox_sync_runs,
  public.mailbox_provider_errors,
  public.mailbox_operational_alerts,
  public.mailbox_provider_verifications
TO salesos_app, salesos_worker;

ALTER TABLE public.mailbox_health_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mailbox_health_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.mailbox_health_events
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE public.mailbox_sync_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mailbox_sync_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.mailbox_sync_runs
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE public.mailbox_provider_errors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mailbox_provider_errors FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.mailbox_provider_errors
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE public.mailbox_operational_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mailbox_operational_alerts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.mailbox_operational_alerts
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE public.mailbox_provider_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mailbox_provider_verifications FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.mailbox_provider_verifications
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

INSERT INTO public.role_permissions (tenant_id, role_id, permission)
SELECT r.tenant_id, r.id, p.permission
FROM public.roles r
CROSS JOIN (VALUES
  ('mailbox.operations.read'), ('mailbox.operations.manage'), ('mailbox.sync.trigger'), ('mailbox.sync.recover'), ('mailbox.health.read')
) AS p(permission)
WHERE r.name IN ('OWNER', 'ADMIN', 'Owner', 'Admin')
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (tenant_id, role_id, permission)
SELECT r.tenant_id, r.id, p.permission
FROM public.roles r
CROSS JOIN (VALUES ('mailbox.operations.read'), ('mailbox.health.read')) AS p(permission)
WHERE r.name IN ('SALES_MANAGER', 'Manager')
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (tenant_id, role_id, permission)
SELECT r.tenant_id, r.id, 'mailbox.health.read'
FROM public.roles r
WHERE r.name IN ('Reviewer')
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.list_due_mailbox_connections()
RETURNS TABLE (tenant_id uuid, connection_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $body$
  SELECT connection.tenant_id, connection.id
  FROM public.mailbox_connections AS connection
  WHERE connection.provider IN ('google', 'microsoft')
    AND connection.status IN ('CONFIGURED_UNVERIFIED', 'SYNCED', 'SYNC_PARTIAL')
    AND connection.sync_paused = false
    AND connection.sending_enabled = false
    AND connection.live = false;
$body$;

ALTER FUNCTION public.list_due_mailbox_connections() OWNER TO salesos_directory;
REVOKE ALL ON FUNCTION public.list_due_mailbox_connections() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_due_mailbox_connections() TO salesos_worker;
