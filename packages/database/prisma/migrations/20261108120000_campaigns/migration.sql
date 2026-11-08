-- Campaign preparation and non-delivering simulation.
-- sending_status and live_delivery cannot record an authorized external send.
-- Recovery: drop the new tables in reverse dependency order.

CREATE TABLE public.audience_segments (
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  kind text NOT NULL,
  owner_user_id uuid,
  current_version_id uuid,
  revision integer NOT NULL DEFAULT 1,
  created_by uuid NOT NULL,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE public.audience_segment_versions (
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  segment_id uuid NOT NULL,
  version_number integer NOT NULL,
  filter jsonb NOT NULL,
  frozen boolean NOT NULL DEFAULT false,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, segment_id, version_number),
  FOREIGN KEY (tenant_id, segment_id) REFERENCES public.audience_segments (tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE public.audience_members (
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  segment_version_id uuid NOT NULL,
  lead_id uuid NOT NULL,
  contact_id uuid,
  identity_key text,
  decision text NOT NULL,
  reasons jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, segment_version_id, lead_id),
  FOREIGN KEY (tenant_id, segment_version_id) REFERENCES public.audience_segment_versions (tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE public.campaigns (
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  goal text NOT NULL DEFAULT '',
  campaign_type text NOT NULL DEFAULT 'OUTREACH',
  product_id uuid,
  product_version_id uuid,
  icp_ref text,
  owner_user_id uuid,
  segment_id uuid,
  segment_version_id uuid,
  sequence_id uuid,
  sequence_version_id uuid,
  channel text NOT NULL DEFAULT 'EMAIL',
  starts_at timestamptz,
  ends_at timestamptz,
  time_zone text NOT NULL DEFAULT 'UTC',
  state text NOT NULL DEFAULT 'DRAFT',
  approval_mode text NOT NULL DEFAULT 'HUMAN',
  sending_status text NOT NULL DEFAULT 'NOT_AUTHORIZED' CHECK (sending_status = 'NOT_AUTHORIZED'),
  live_delivery boolean NOT NULL DEFAULT false CHECK (live_delivery = false),
  revision integer NOT NULL DEFAULT 1,
  created_by uuid NOT NULL,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, product_id) REFERENCES public.products (tenant_id, id),
  FOREIGN KEY (tenant_id, product_version_id) REFERENCES public.product_versions (tenant_id, id),
  FOREIGN KEY (tenant_id, segment_id) REFERENCES public.audience_segments (tenant_id, id),
  FOREIGN KEY (tenant_id, segment_version_id) REFERENCES public.audience_segment_versions (tenant_id, id)
);

CREATE INDEX campaigns_tenant_state_idx ON public.campaigns (tenant_id, state, updated_at);

CREATE TABLE public.campaign_products (
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL,
  product_id uuid NOT NULL,
  product_version_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, campaign_id, product_version_id),
  FOREIGN KEY (tenant_id, campaign_id) REFERENCES public.campaigns (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, product_version_id) REFERENCES public.product_versions (tenant_id, id)
);

CREATE TABLE public.campaign_audiences (
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL,
  segment_id uuid NOT NULL,
  segment_version_id uuid NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, campaign_id) REFERENCES public.campaigns (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, segment_version_id) REFERENCES public.audience_segment_versions (tenant_id, id)
);

CREATE TABLE public.campaign_exclusions (
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL,
  identity_key text,
  lead_id uuid,
  reason text NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, campaign_id) REFERENCES public.campaigns (tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE public.campaign_sequences (
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  current_version_id uuid,
  revision integer NOT NULL DEFAULT 1,
  created_by uuid NOT NULL,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE public.campaign_sequence_versions (
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  sequence_id uuid NOT NULL,
  version_number integer NOT NULL,
  frozen boolean NOT NULL DEFAULT false,
  product_version_id uuid,
  approval_required boolean NOT NULL DEFAULT true,
  time_zone text NOT NULL DEFAULT 'UTC',
  stop_policy jsonb NOT NULL DEFAULT '{}',
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, sequence_id, version_number),
  FOREIGN KEY (tenant_id, sequence_id) REFERENCES public.campaign_sequences (tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE public.campaign_sequence_steps (
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  sequence_version_id uuid NOT NULL,
  position integer NOT NULL,
  step_type text NOT NULL,
  config jsonb NOT NULL DEFAULT '{}',
  template_version_id uuid,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, sequence_version_id, position),
  FOREIGN KEY (tenant_id, sequence_version_id) REFERENCES public.campaign_sequence_versions (tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE public.campaign_sequence_conditions (
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  step_id uuid NOT NULL,
  field text NOT NULL,
  operator text NOT NULL,
  expected jsonb NOT NULL DEFAULT '{}',
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, step_id) REFERENCES public.campaign_sequence_steps (tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE public.campaign_templates (
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  product_id uuid,
  locale text NOT NULL DEFAULT 'en',
  current_version_id uuid,
  revision integer NOT NULL DEFAULT 1,
  created_by uuid NOT NULL,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE public.campaign_template_versions (
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL,
  version_number integer NOT NULL,
  subject text NOT NULL,
  body_text text NOT NULL,
  body_html text,
  review_state text NOT NULL DEFAULT 'DRAFT',
  frozen boolean NOT NULL DEFAULT false,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, template_id, version_number),
  FOREIGN KEY (tenant_id, template_id) REFERENCES public.campaign_templates (tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE public.campaign_enrollments (
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL,
  sequence_version_id uuid NOT NULL,
  segment_version_id uuid NOT NULL,
  product_version_id uuid,
  icp_ref text,
  lead_id uuid NOT NULL,
  contact_id uuid,
  identity_key text NOT NULL,
  channel text NOT NULL,
  status text NOT NULL,
  decision text NOT NULL,
  reasons jsonb NOT NULL DEFAULT '[]',
  current_step integer NOT NULL DEFAULT 0,
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, campaign_id, channel, identity_key),
  FOREIGN KEY (tenant_id, campaign_id) REFERENCES public.campaigns (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, sequence_version_id) REFERENCES public.campaign_sequence_versions (tenant_id, id),
  FOREIGN KEY (tenant_id, segment_version_id) REFERENCES public.audience_segment_versions (tenant_id, id)
);

CREATE TABLE public.campaign_step_executions (
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  enrollment_id uuid NOT NULL,
  step_id uuid NOT NULL,
  position integer NOT NULL,
  status text NOT NULL,
  outcome text NOT NULL,
  idempotency_key text NOT NULL,
  scheduled_for timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  detail jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (tenant_id, enrollment_id) REFERENCES public.campaign_enrollments (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, step_id) REFERENCES public.campaign_sequence_steps (tenant_id, id)
);

CREATE TABLE public.campaign_drafts (
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL,
  enrollment_id uuid,
  step_id uuid,
  contact_id uuid,
  state text NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, campaign_id) REFERENCES public.campaigns (tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE public.campaign_draft_versions (
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  draft_id uuid NOT NULL,
  version_number integer NOT NULL,
  subject text NOT NULL,
  body_text text NOT NULL,
  body_html text,
  facts jsonb NOT NULL DEFAULT '[]',
  citations jsonb NOT NULL DEFAULT '[]',
  model_provider text,
  model_name text,
  template_version_id uuid,
  digest text NOT NULL,
  edited_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, draft_id, version_number),
  FOREIGN KEY (tenant_id, draft_id) REFERENCES public.campaign_drafts (tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE public.campaign_approvals (
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  subject_id uuid NOT NULL,
  version_ref text NOT NULL,
  digest text NOT NULL,
  state text NOT NULL,
  requested_by uuid NOT NULL,
  decided_by uuid,
  expires_at timestamptz NOT NULL,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);

CREATE UNIQUE INDEX campaign_approvals_one_pending
  ON public.campaign_approvals (tenant_id, kind, subject_id, version_ref)
  WHERE state = 'PENDING';

CREATE TABLE public.campaign_schedules (
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL,
  enrollment_id uuid,
  step_execution_id uuid,
  run_at timestamptz NOT NULL,
  time_zone text NOT NULL,
  status text NOT NULL,
  kind text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, campaign_id) REFERENCES public.campaigns (tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE public.campaign_runs (
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL,
  sequence_version_id uuid,
  segment_version_id uuid,
  state text NOT NULL,
  trace_id text NOT NULL,
  outcome jsonb NOT NULL DEFAULT '{}',
  started_at timestamptz,
  finished_at timestamptz,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, campaign_id) REFERENCES public.campaigns (tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE public.campaign_policy_evaluations (
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL,
  enrollment_id uuid,
  lead_id uuid,
  decision text NOT NULL,
  reasons jsonb NOT NULL DEFAULT '[]',
  evidence jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, campaign_id) REFERENCES public.campaigns (tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE public.campaign_activity (
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL,
  action text NOT NULL,
  actor_id uuid,
  from_state text,
  to_state text,
  detail jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, campaign_id) REFERENCES public.campaigns (tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE public.campaign_analytics_snapshots (
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  campaign_id uuid,
  window_start timestamptz NOT NULL,
  window_end timestamptz NOT NULL,
  metrics jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, campaign_id) REFERENCES public.campaigns (tenant_id, id) ON DELETE CASCADE
);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.audience_segments,
  public.audience_segment_versions,
  public.audience_members,
  public.campaigns,
  public.campaign_products,
  public.campaign_audiences,
  public.campaign_exclusions,
  public.campaign_sequences,
  public.campaign_sequence_versions,
  public.campaign_sequence_steps,
  public.campaign_sequence_conditions,
  public.campaign_templates,
  public.campaign_template_versions,
  public.campaign_enrollments,
  public.campaign_step_executions,
  public.campaign_drafts,
  public.campaign_draft_versions,
  public.campaign_approvals,
  public.campaign_schedules,
  public.campaign_runs,
  public.campaign_policy_evaluations,
  public.campaign_activity,
  public.campaign_analytics_snapshots
TO salesos_app, salesos_worker;

DO $$
DECLARE name text;
BEGIN
  FOREACH name IN ARRAY ARRAY[
    'audience_segments', 'audience_segment_versions', 'audience_members', 'campaigns', 'campaign_products',
    'campaign_audiences', 'campaign_exclusions', 'campaign_sequences', 'campaign_sequence_versions',
    'campaign_sequence_steps', 'campaign_sequence_conditions', 'campaign_templates', 'campaign_template_versions',
    'campaign_enrollments', 'campaign_step_executions', 'campaign_drafts', 'campaign_draft_versions',
    'campaign_approvals', 'campaign_schedules', 'campaign_runs', 'campaign_policy_evaluations',
    'campaign_activity', 'campaign_analytics_snapshots'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', name);
    EXECUTE format('CREATE POLICY tenant_isolation ON public.%I USING (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid) WITH CHECK (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)', name);
  END LOOP;
END $$;

INSERT INTO public.role_permissions (tenant_id, role_id, permission)
SELECT r.tenant_id, r.id, p.permission
FROM public.roles r
CROSS JOIN (VALUES
  ('campaigns.read'), ('campaigns.create'), ('campaigns.edit'), ('campaigns.archive'),
  ('campaigns.audience.manage'), ('campaigns.sequence.manage'), ('campaigns.template.manage'),
  ('campaigns.review'), ('campaigns.simulate'), ('campaigns.analytics.read')
) AS p(permission)
WHERE r.name IN ('OWNER', 'ADMIN', 'Owner', 'Admin')
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (tenant_id, role_id, permission)
SELECT r.tenant_id, r.id, p.permission
FROM public.roles r
CROSS JOIN (VALUES
  ('campaigns.read'), ('campaigns.create'), ('campaigns.edit'), ('campaigns.archive'),
  ('campaigns.audience.manage'), ('campaigns.sequence.manage'), ('campaigns.template.manage'),
  ('campaigns.simulate'), ('campaigns.analytics.read')
) AS p(permission)
WHERE r.name IN ('SALES_MANAGER', 'Manager')
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (tenant_id, role_id, permission)
SELECT r.tenant_id, r.id, p.permission
FROM public.roles r
CROSS JOIN (VALUES ('campaigns.read'), ('campaigns.review'), ('campaigns.analytics.read')) AS p(permission)
WHERE r.name = 'Reviewer'
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (tenant_id, role_id, permission)
SELECT r.tenant_id, r.id, p.permission
FROM public.roles r
CROSS JOIN (VALUES ('campaigns.read'), ('campaigns.analytics.read')) AS p(permission)
WHERE r.name IN ('Analyst', 'VIEWER')
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (tenant_id, role_id, permission)
SELECT r.tenant_id, r.id, 'campaigns.read'
FROM public.roles r
WHERE r.name IN ('Sales', 'SALES_AGENT')
ON CONFLICT DO NOTHING;
