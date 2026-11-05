ALTER TABLE public.mailbox_connections
  ADD COLUMN send_capability text NOT NULL DEFAULT 'READ_ONLY';

ALTER TABLE public.mailbox_send_attempts
  ADD COLUMN acceptance_state text,
  ADD COLUMN correlation_id text,
  ADD COLUMN http_status integer;

CREATE TABLE public.email_send_policies (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants (id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  kill_switch boolean NOT NULL DEFAULT false,
  hourly_cap integer NOT NULL DEFAULT 20,
  daily_cap integer NOT NULL DEFAULT 100,
  max_recipients integer NOT NULL DEFAULT 5,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.email_send_quotas (
  tenant_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  period_start date NOT NULL,
  accepted_count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, connection_id, period_start)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.email_send_policies, public.email_send_quotas TO salesos_app, salesos_worker;

ALTER TABLE public.email_send_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_send_policies FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.email_send_policies
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE public.email_send_quotas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_send_quotas FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.email_send_quotas
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

INSERT INTO public.role_permissions (tenant_id, role_id, permission)
SELECT r.tenant_id, r.id, p.permission
FROM public.roles r
CROSS JOIN (VALUES
  ('mailbox.send.request'), ('mailbox.send.execute'), ('mailbox.send.review'), ('mailbox.send.manage')
) AS p(permission)
WHERE r.name IN ('OWNER', 'ADMIN', 'Owner')
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (tenant_id, role_id, permission)
SELECT r.tenant_id, r.id, p.permission
FROM public.roles r
CROSS JOIN (VALUES ('mailbox.send.review')) AS p(permission)
WHERE r.name IN ('SALES_MANAGER', 'Manager', 'Reviewer', 'Admin')
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (tenant_id, role_id, permission)
SELECT r.tenant_id, r.id, p.permission
FROM public.roles r
CROSS JOIN (VALUES ('mailbox.send.request')) AS p(permission)
WHERE r.name IN ('SALES_AGENT', 'Sales')
ON CONFLICT DO NOTHING;
