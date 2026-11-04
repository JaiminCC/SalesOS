-- Tenant isolation and the least privilege the application role needs.
-- Create the role first with `pnpm db:role`. This migration refuses to guess a password.

DO $body$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'salesos_app') THEN
    RAISE EXCEPTION 'salesos_app is missing. Run pnpm db:role before pnpm db:migrate';
  END IF;
END
$body$;

GRANT USAGE ON SCHEMA public TO salesos_app;

REVOKE ALL ON TABLE
  tenants,
  users,
  sessions,
  mfa_factors,
  recovery_codes,
  password_reset_tokens,
  auth_attempts
FROM salesos_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  memberships,
  roles,
  role_permissions,
  membership_roles,
  outbox_events,
  idempotency_keys,
  job_executions
TO salesos_app;

GRANT SELECT, INSERT ON TABLE audit_events TO salesos_app;

DO $body$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'memberships',
    'roles',
    'role_permissions',
    'membership_roles',
    'audit_events',
    'outbox_events',
    'idempotency_keys',
    'job_executions'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid) WITH CHECK (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)',
      table_name
    );
  END LOOP;
END
$body$;

CREATE OR REPLACE FUNCTION tenant_is_active(target uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $body$
  SELECT EXISTS (
    SELECT 1 FROM tenants WHERE id = target AND status = 'ACTIVE'
  );
$body$;

REVOKE ALL ON FUNCTION tenant_is_active(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tenant_is_active(uuid) TO salesos_app;

CREATE OR REPLACE FUNCTION list_pending_outbox(batch_size integer)
RETURNS TABLE (
  tenant_id uuid,
  id uuid,
  event_type text,
  aggregate_id uuid,
  payload jsonb,
  attempts integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $body$
  SELECT tenant_id, id, event_type, aggregate_id, payload, attempts
  FROM outbox_events
  WHERE status = 'PENDING'
  ORDER BY created_at
  LIMIT GREATEST(batch_size, 0);
$body$;

REVOKE ALL ON FUNCTION list_pending_outbox(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION list_pending_outbox(integer) TO salesos_app;
