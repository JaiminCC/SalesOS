ALTER TABLE public.agent_profiles
  ADD COLUMN model_configuration_id uuid,
  ADD COLUMN default_product_id uuid;

ALTER TABLE public.agent_runs
  ADD COLUMN product_id uuid,
  ADD COLUMN goal text NOT NULL DEFAULT '',
  ADD COLUMN model_configuration_id uuid,
  ADD COLUMN context_sha256 text,
  ADD COLUMN context_snapshot jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN citations jsonb NOT NULL DEFAULT '[]',
  ADD COLUMN plan jsonb NOT NULL DEFAULT '[]',
  ADD COLUMN report jsonb,
  ADD COLUMN constraints jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN lease_token text,
  ADD COLUMN lease_until timestamptz,
  ADD COLUMN lease_version integer NOT NULL DEFAULT 0;

ALTER TABLE public.llm_usage
  ADD COLUMN usage_source text NOT NULL DEFAULT 'estimated',
  ADD COLUMN trace_id text,
  ADD COLUMN duration_ms integer,
  ADD COLUMN request_status text,
  ADD COLUMN retry_count integer NOT NULL DEFAULT 0;

CREATE TABLE public.model_configurations (
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  provider text NOT NULL,
  model text NOT NULL,
  base_url text,
  auth_method text NOT NULL DEFAULT 'none',
  credential_ciphertext bytea,
  credential_hint text,
  timeout_ms integer NOT NULL DEFAULT 10000,
  max_retries integer NOT NULL DEFAULT 1,
  max_input_tokens integer NOT NULL DEFAULT 6000,
  max_output_tokens integer NOT NULL DEFAULT 800,
  temperature numeric(3,2) NOT NULL DEFAULT 0,
  input_price_minor_per_million integer NOT NULL DEFAULT 0,
  output_price_minor_per_million integer NOT NULL DEFAULT 0,
  currency char(3) NOT NULL DEFAULT 'USD',
  enabled boolean NOT NULL DEFAULT true,
  is_default boolean NOT NULL DEFAULT false,
  allow_private_http boolean NOT NULL DEFAULT false,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);

CREATE UNIQUE INDEX model_configurations_one_default
  ON public.model_configurations (tenant_id)
  WHERE is_default AND enabled;

CREATE TABLE public.agent_approvals (
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL,
  action_id uuid NOT NULL,
  payload_sha256 text NOT NULL,
  action_type text NOT NULL,
  risk_level text NOT NULL,
  requested_by uuid NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  decided_by uuid,
  decision text NOT NULL DEFAULT 'PENDING',
  decided_at timestamptz,
  comment text,
  policy_version text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, run_id) REFERENCES public.agent_runs (tenant_id, id),
  FOREIGN KEY (tenant_id, action_id) REFERENCES public.agent_actions (tenant_id, id)
);

CREATE UNIQUE INDEX agent_approvals_one_pending
  ON public.agent_approvals (tenant_id, action_id)
  WHERE decision = 'PENDING';

CREATE TABLE public.agent_tool_calls (
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL,
  tool_name text NOT NULL,
  tool_version text NOT NULL,
  idempotency_key text NOT NULL,
  status text NOT NULL,
  input_redacted jsonb NOT NULL DEFAULT '{}',
  output_redacted jsonb,
  attempts integer NOT NULL DEFAULT 0,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (tenant_id, run_id) REFERENCES public.agent_runs (tenant_id, id)
);

CREATE TABLE public.usage_counters (
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  period_start date NOT NULL,
  reserved_minor integer NOT NULL DEFAULT 0,
  spent_minor integer NOT NULL DEFAULT 0,
  active_runs integer NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, period_start)
);

DO $body$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'model_configurations',
    'agent_approvals',
    'agent_tool_calls',
    'usage_counters'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON public.%I USING (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid) WITH CHECK (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)',
      table_name
    );
    EXECUTE format('DROP TRIGGER IF EXISTS reject_delete ON public.%I', table_name);
    EXECUTE format(
      'CREATE TRIGGER reject_delete BEFORE DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.reject_agent_history_delete()',
      table_name
    );
  END LOOP;
END
$body$;

GRANT SELECT, INSERT, UPDATE ON TABLE
  public.model_configurations,
  public.agent_approvals,
  public.agent_tool_calls,
  public.usage_counters
TO salesos_app, salesos_worker;

REVOKE ALL ON TABLE
  public.model_configurations,
  public.agent_approvals,
  public.agent_tool_calls,
  public.usage_counters
FROM salesos_identity;

CREATE FUNCTION public.read_execution_gate(target uuid)
RETURNS TABLE (tenant_status text, automation_status text, llm_monthly_budget_minor integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $body$
  SELECT t.status, t.automation_status, t.llm_monthly_budget_minor
  FROM public.tenants t
  WHERE t.id = target
    AND t.id = nullif(current_setting('app.tenant_id', true), '')::uuid;
$body$;

REVOKE ALL ON FUNCTION public.read_execution_gate(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.read_execution_gate(uuid) TO salesos_app, salesos_worker;
