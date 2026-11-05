ALTER TABLE public.tenants
  ADD COLUMN llm_monthly_budget_minor integer NOT NULL DEFAULT 1000000,
  ADD COLUMN llm_provider text NOT NULL DEFAULT 'fake';

CREATE TABLE public.agent_profiles (
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  role text NOT NULL,
  instructions text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'ACTIVE',
  enabled boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);

CREATE INDEX agent_profiles_status_idx ON public.agent_profiles (tenant_id, status, created_at);

CREATE TABLE public.automation_policies (
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE',
  autonomy_level text NOT NULL DEFAULT 'A4',
  channel text,
  action_type text,
  constraints jsonb NOT NULL DEFAULT '{}',
  version integer NOT NULL DEFAULT 1,
  effective_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE public.agent_runs (
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  agent_id uuid,
  trigger_type text NOT NULL,
  source_event_id text,
  state text NOT NULL DEFAULT 'QUEUED',
  model_provider text,
  model_name text,
  prompt_version text,
  input_redacted jsonb NOT NULL DEFAULT '{}',
  started_at timestamptz,
  finished_at timestamptz,
  error_code text,
  parent_run_id uuid,
  product_version_id uuid,
  archived_at timestamptz,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, agent_id) REFERENCES public.agent_profiles (tenant_id, id),
  FOREIGN KEY (tenant_id, parent_run_id) REFERENCES public.agent_runs (tenant_id, id)
);

CREATE INDEX agent_runs_state_idx ON public.agent_runs (tenant_id, state, created_at DESC);

CREATE TABLE public.agent_run_steps (
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL,
  position integer NOT NULL,
  name text NOT NULL,
  status text NOT NULL,
  detail_redacted jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, run_id, position),
  FOREIGN KEY (tenant_id, run_id) REFERENCES public.agent_runs (tenant_id, id)
);

CREATE TABLE public.agent_actions (
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL,
  action_type text NOT NULL,
  target_type text NOT NULL,
  target_id uuid,
  risk_level text NOT NULL DEFAULT 'LOW',
  policy_version text,
  policy_decision text,
  state text NOT NULL DEFAULT 'PROPOSED',
  requires_human_approval boolean NOT NULL DEFAULT true,
  approved_by uuid,
  due_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  idempotency_key text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  outcome jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (tenant_id, run_id) REFERENCES public.agent_runs (tenant_id, id)
);

CREATE INDEX agent_actions_due_idx ON public.agent_actions (tenant_id, state, due_at);

CREATE TABLE public.llm_usage (
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL,
  provider text NOT NULL,
  model text NOT NULL,
  input_tokens integer NOT NULL,
  output_tokens integer NOT NULL,
  cost_minor integer NOT NULL DEFAULT 0,
  currency char(3) NOT NULL DEFAULT 'USD',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, run_id) REFERENCES public.agent_runs (tenant_id, id)
);

CREATE INDEX llm_usage_created_idx ON public.llm_usage (tenant_id, created_at DESC);

CREATE FUNCTION public.reject_agent_history_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $body$
BEGIN
  RAISE EXCEPTION 'agent history cannot be hard-deleted';
END;
$body$;

DO $body$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'agent_profiles',
    'automation_policies',
    'agent_runs',
    'agent_run_steps',
    'agent_actions',
    'llm_usage'
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
  public.agent_profiles,
  public.automation_policies,
  public.agent_runs,
  public.agent_run_steps,
  public.agent_actions,
  public.llm_usage
TO salesos_app;

GRANT SELECT, INSERT, UPDATE ON TABLE
  public.agent_profiles,
  public.automation_policies,
  public.agent_runs,
  public.agent_run_steps,
  public.agent_actions,
  public.llm_usage
TO salesos_worker;

REVOKE ALL ON TABLE
  public.agent_profiles,
  public.automation_policies,
  public.agent_runs,
  public.agent_run_steps,
  public.agent_actions,
  public.llm_usage
FROM salesos_identity;

CREATE FUNCTION public.read_automation_settings(target uuid)
RETURNS TABLE (automation_status text, llm_monthly_budget_minor integer, llm_provider text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $body$
  SELECT t.automation_status, t.llm_monthly_budget_minor, t.llm_provider
  FROM public.tenants t
  WHERE t.id = target
    AND t.id = nullif(current_setting('app.tenant_id', true), '')::uuid;
$body$;

CREATE FUNCTION public.set_automation_status(next_status text, actor uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $body$
BEGIN
  IF next_status NOT IN ('RUNNING', 'PAUSED') THEN
    RAISE EXCEPTION 'invalid automation status';
  END IF;
  UPDATE public.tenants
  SET automation_status = next_status,
      automation_paused_at = CASE WHEN next_status = 'PAUSED' THEN statement_timestamp() ELSE NULL END,
      automation_paused_by = CASE WHEN next_status = 'PAUSED' THEN actor ELSE NULL END
  WHERE id = nullif(current_setting('app.tenant_id', true), '')::uuid
    AND id = nullif(current_setting('app.tenant_id', true), '')::uuid;
  RETURN next_status;
END;
$body$;

REVOKE ALL ON FUNCTION public.read_automation_settings(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_automation_status(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.read_automation_settings(uuid) TO salesos_app, salesos_worker;
GRANT EXECUTE ON FUNCTION public.set_automation_status(text, uuid) TO salesos_app;
