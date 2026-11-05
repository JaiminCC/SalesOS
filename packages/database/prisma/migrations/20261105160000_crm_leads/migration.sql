CREATE TABLE public.crm_accounts (
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  legal_name text NOT NULL,
  display_name text NOT NULL,
  website text,
  domain text,
  industry text,
  subindustry text,
  business_model text,
  description text,
  size_range text,
  employee_estimate integer,
  employee_status text NOT NULL DEFAULT 'UNKNOWN',
  revenue_range text,
  revenue_status text NOT NULL DEFAULT 'UNKNOWN',
  country text,
  region text,
  locations jsonb NOT NULL DEFAULT '[]',
  technologies jsonb NOT NULL DEFAULT '[]',
  signals jsonb NOT NULL DEFAULT '[]',
  source text NOT NULL DEFAULT 'manual',
  verification_status text NOT NULL DEFAULT 'UNKNOWN',
  owner_user_id uuid,
  lifecycle_status text NOT NULL DEFAULT 'ACTIVE',
  custom jsonb NOT NULL DEFAULT '{}',
  revision integer NOT NULL DEFAULT 1,
  archived_at timestamptz,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);

CREATE UNIQUE INDEX crm_accounts_domain ON public.crm_accounts (tenant_id, domain) WHERE domain IS NOT NULL AND archived_at IS NULL;

CREATE TABLE public.crm_contacts (
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  account_id uuid,
  name text NOT NULL,
  job_title text,
  department text,
  seniority text,
  email_ciphertext bytea,
  email_hmac text,
  email_hint text,
  phone_ciphertext bytea,
  phone_hmac text,
  phone_hint text,
  profile_url text,
  country text,
  timezone text,
  contact_role text,
  decision_class text NOT NULL DEFAULT 'UNKNOWN',
  verification_status text NOT NULL DEFAULT 'UNKNOWN',
  source text NOT NULL DEFAULT 'manual',
  provenance jsonb NOT NULL DEFAULT '{}',
  consent_state text NOT NULL DEFAULT 'UNKNOWN',
  revision integer NOT NULL DEFAULT 1,
  archived_at timestamptz,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, account_id) REFERENCES public.crm_accounts (tenant_id, id)
);

CREATE UNIQUE INDEX crm_contacts_email ON public.crm_contacts (tenant_id, email_hmac) WHERE email_hmac IS NOT NULL AND archived_at IS NULL;

CREATE TABLE public.crm_leads (
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL,
  contact_id uuid,
  product_id uuid,
  product_version_id uuid,
  icp_name text,
  source_type text NOT NULL,
  source_ref text,
  score integer,
  grade text NOT NULL DEFAULT 'UNRATED',
  confidence numeric(3,2) NOT NULL DEFAULT 0,
  stage text NOT NULL DEFAULT 'NEW',
  owner_user_id uuid,
  eligibility_state text NOT NULL DEFAULT 'CONSENT_UNKNOWN',
  suppression_state text NOT NULL DEFAULT 'CLEAR',
  last_researched_at timestamptz,
  next_review_at timestamptz,
  revision integer NOT NULL DEFAULT 1,
  archived_at timestamptz,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, account_id) REFERENCES public.crm_accounts (tenant_id, id),
  FOREIGN KEY (tenant_id, contact_id) REFERENCES public.crm_contacts (tenant_id, id)
);

CREATE UNIQUE INDEX crm_leads_product_account ON public.crm_leads (tenant_id, account_id, product_id) WHERE product_id IS NOT NULL AND archived_at IS NULL;

CREATE TABLE public.crm_lead_contacts (
  tenant_id uuid NOT NULL,
  lead_id uuid NOT NULL,
  contact_id uuid NOT NULL,
  relationship text NOT NULL DEFAULT 'RELATED',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, lead_id, contact_id),
  FOREIGN KEY (tenant_id, lead_id) REFERENCES public.crm_leads (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, contact_id) REFERENCES public.crm_contacts (tenant_id, id)
);

CREATE TABLE public.crm_stage_history (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL,
  from_stage text,
  to_stage text NOT NULL,
  reason text,
  actor_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, lead_id) REFERENCES public.crm_leads (tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE public.crm_activities (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  lead_id uuid,
  account_id uuid,
  kind text NOT NULL,
  summary text NOT NULL,
  actor_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE public.crm_assignments (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  subject_type text NOT NULL,
  subject_id uuid NOT NULL,
  owner_user_id uuid,
  reason text,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  actor_id uuid NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE public.crm_takeovers (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  subject_type text NOT NULL,
  subject_id uuid NOT NULL,
  active boolean NOT NULL DEFAULT true,
  reason text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  actor_id uuid NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE UNIQUE INDEX crm_takeovers_one_active ON public.crm_takeovers (tenant_id, subject_type, subject_id) WHERE active;

CREATE TABLE public.crm_evidence (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  lead_id uuid,
  account_id uuid,
  claim text NOT NULL,
  provenance text NOT NULL,
  source_ref text,
  excerpt text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE public.crm_qualifications (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL,
  product_version_id uuid,
  icp_name text,
  scoring_version text NOT NULL,
  score integer NOT NULL,
  grade text NOT NULL,
  confidence numeric(3,2) NOT NULL,
  dimensions jsonb NOT NULL,
  weights jsonb NOT NULL,
  explanation text,
  model_provider text,
  model_name text,
  run_id uuid,
  overridden boolean NOT NULL DEFAULT false,
  override_reason text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, lead_id) REFERENCES public.crm_leads (tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE public.crm_import_batches (
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  status text NOT NULL,
  file_name text NOT NULL,
  mapping jsonb NOT NULL DEFAULT '{}',
  policy text NOT NULL DEFAULT 'skip',
  row_count integer NOT NULL DEFAULT 0,
  error_count integer NOT NULL DEFAULT 0,
  storage_key text,
  idempotency_key text NOT NULL,
  revision integer NOT NULL DEFAULT 1,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, idempotency_key)
);

CREATE TABLE public.crm_import_rows (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL,
  row_number integer NOT NULL,
  status text NOT NULL,
  payload jsonb NOT NULL,
  error text,
  account_id uuid,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, batch_id) REFERENCES public.crm_import_batches (tenant_id, id) ON DELETE CASCADE,
  UNIQUE (tenant_id, batch_id, row_number)
);

CREATE TABLE public.crm_duplicate_candidates (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  left_account_id uuid NOT NULL,
  right_account_id uuid NOT NULL,
  confidence numeric(3,2) NOT NULL,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'OPEN',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE public.crm_suppressions (
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  scope text NOT NULL,
  subject_hmac text,
  subject_hint text,
  account_id uuid,
  contact_id uuid,
  channel text,
  purpose text,
  reason text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  removed_at timestamptz,
  removed_by uuid,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE public.crm_eligibility (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  lead_id uuid,
  contact_id uuid,
  state text NOT NULL,
  reasons jsonb NOT NULL,
  facts jsonb NOT NULL,
  policy_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE public.crm_discovery_sources (
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  provider_id text NOT NULL,
  label text NOT NULL,
  mode text NOT NULL,
  live boolean NOT NULL DEFAULT false,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, provider_id)
);

CREATE TABLE public.crm_discovery_jobs (
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  product_id uuid,
  icp_name text,
  provider_id text NOT NULL,
  status text NOT NULL,
  criteria jsonb NOT NULL DEFAULT '{}',
  max_candidates integer NOT NULL DEFAULT 25,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE public.crm_discovery_candidates (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL,
  name text NOT NULL,
  domain text,
  industry text,
  country text,
  provider_id text NOT NULL,
  provider_mode text NOT NULL,
  live boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'CANDIDATE',
  account_id uuid,
  evidence jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, job_id) REFERENCES public.crm_discovery_jobs (tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE public.crm_contact_policies (
  tenant_id uuid NOT NULL PRIMARY KEY REFERENCES public.tenants (id) ON DELETE CASCADE,
  timezone text,
  weekdays jsonb NOT NULL DEFAULT '[1,2,3,4,5]',
  start_minute integer NOT NULL DEFAULT 540,
  end_minute integer NOT NULL DEFAULT 1020,
  holidays jsonb NOT NULL DEFAULT '[]',
  minimum_interval_hours integer NOT NULL DEFAULT 24,
  max_attempts integer NOT NULL DEFAULT 3,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.agent_runs ADD COLUMN lead_id uuid;
ALTER TABLE public.agent_runs
  ADD CONSTRAINT agent_runs_lead_fk FOREIGN KEY (tenant_id, lead_id) REFERENCES public.crm_leads (tenant_id, id);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.crm_accounts, public.crm_contacts, public.crm_leads, public.crm_lead_contacts,
  public.crm_stage_history, public.crm_activities, public.crm_assignments, public.crm_takeovers,
  public.crm_evidence, public.crm_qualifications, public.crm_import_batches, public.crm_import_rows,
  public.crm_duplicate_candidates, public.crm_suppressions, public.crm_eligibility,
  public.crm_discovery_sources, public.crm_discovery_jobs, public.crm_discovery_candidates,
  public.crm_contact_policies
TO salesos_app, salesos_worker;

DO $body$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'crm_accounts','crm_contacts','crm_leads','crm_lead_contacts','crm_stage_history','crm_activities',
    'crm_assignments','crm_takeovers','crm_evidence','crm_qualifications','crm_import_batches','crm_import_rows',
    'crm_duplicate_candidates','crm_suppressions','crm_eligibility','crm_discovery_sources','crm_discovery_jobs',
    'crm_discovery_candidates','crm_contact_policies'
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

INSERT INTO public.role_permissions (tenant_id, role_id, permission)
SELECT r.tenant_id, r.id, p.permission
FROM public.roles r
CROSS JOIN (VALUES
  ('crm.accounts.read'), ('crm.accounts.write'), ('crm.contacts.read'), ('crm.contacts.write'),
  ('crm.leads.read'), ('crm.leads.write'), ('crm.leads.assign'), ('crm.leads.import'),
  ('crm.leads.discover'), ('crm.leads.qualify'), ('crm.leads.merge'),
  ('crm.suppression.read'), ('crm.suppression.manage'), ('crm.contact_policy.manage')
) AS p(permission)
WHERE r.name IN ('OWNER', 'ADMIN', 'Owner', 'Admin')
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (tenant_id, role_id, permission)
SELECT r.tenant_id, r.id, p.permission
FROM public.roles r
CROSS JOIN (VALUES
  ('crm.accounts.read'), ('crm.accounts.write'), ('crm.contacts.read'), ('crm.contacts.write'),
  ('crm.leads.read'), ('crm.leads.write'), ('crm.leads.assign'), ('crm.leads.import'),
  ('crm.leads.discover'), ('crm.leads.qualify'), ('crm.suppression.read')
) AS p(permission)
WHERE r.name IN ('SALES_MANAGER', 'Manager')
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (tenant_id, role_id, permission)
SELECT r.tenant_id, r.id, p.permission
FROM public.roles r
CROSS JOIN (VALUES ('crm.accounts.read'), ('crm.contacts.read'), ('crm.leads.read'), ('crm.leads.write')) AS p(permission)
WHERE r.name IN ('SALES_AGENT', 'Sales')
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (tenant_id, role_id, permission)
SELECT r.tenant_id, r.id, p.permission
FROM public.roles r
CROSS JOIN (VALUES ('crm.accounts.read'), ('crm.contacts.read'), ('crm.leads.read'), ('crm.suppression.read')) AS p(permission)
WHERE r.name IN ('VIEWER', 'Analyst', 'Reviewer')
ON CONFLICT DO NOTHING;
