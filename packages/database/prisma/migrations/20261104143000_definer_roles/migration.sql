-- Least privilege for SECURITY DEFINER helpers.
-- salesos_definer reads public.tenants and does not bypass RLS.
-- salesos_outbox bypasses RLS only so the worker can list pending outbox rows.
-- salesos_worker may execute that list. salesos_app may not.
-- Recovery: docs/operations/OUTBOX_RECOVERY.md. Do not grant the list function back to salesos_app.

DO $body$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'salesos_worker') THEN
    RAISE EXCEPTION 'salesos_worker is missing. Run pnpm db:role before pnpm db:migrate';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'salesos_definer') THEN
    CREATE ROLE salesos_definer NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  ELSE
    ALTER ROLE salesos_definer WITH NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'salesos_outbox') THEN
    CREATE ROLE salesos_outbox NOLOGIN NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE;
  ELSE
    ALTER ROLE salesos_outbox WITH NOLOGIN NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END
$body$;

GRANT USAGE ON SCHEMA public TO salesos_definer;
GRANT USAGE ON SCHEMA public TO salesos_outbox;
GRANT USAGE ON SCHEMA public TO salesos_worker;

GRANT SELECT ON TABLE public.tenants TO salesos_definer;
GRANT SELECT ON TABLE public.outbox_events TO salesos_outbox;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.memberships,
  public.roles,
  public.role_permissions,
  public.membership_roles,
  public.outbox_events,
  public.idempotency_keys,
  public.job_executions
TO salesos_worker;

GRANT SELECT, INSERT ON TABLE public.audit_events TO salesos_worker;

REVOKE ALL ON TABLE
  public.tenants,
  public.users,
  public.sessions,
  public.mfa_factors,
  public.recovery_codes,
  public.password_reset_tokens,
  public.auth_attempts
FROM salesos_worker;

DROP FUNCTION IF EXISTS public.list_pending_outbox(integer);
DROP FUNCTION IF EXISTS public.tenant_is_active(uuid);

CREATE FUNCTION public.tenant_is_active(target uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $body$
  SELECT EXISTS (
    SELECT 1
    FROM public.tenants AS tenant
    WHERE tenant.id = target
      AND tenant.status = 'ACTIVE'
  );
$body$;

ALTER FUNCTION public.tenant_is_active(uuid) OWNER TO salesos_definer;
REVOKE ALL ON FUNCTION public.tenant_is_active(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tenant_is_active(uuid) TO salesos_app;
GRANT EXECUTE ON FUNCTION public.tenant_is_active(uuid) TO salesos_worker;

CREATE FUNCTION public.list_pending_outbox(batch_size integer)
RETURNS TABLE (
  tenant_id uuid,
  id uuid,
  event_type text,
  aggregate_id uuid,
  attempts integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $body$
  SELECT event.tenant_id, event.id, event.event_type, event.aggregate_id, event.attempts
  FROM public.outbox_events AS event
  WHERE event.status = 'PENDING'
  ORDER BY event.created_at
  LIMIT LEAST(GREATEST(batch_size, 0), 100);
$body$;

ALTER FUNCTION public.list_pending_outbox(integer) OWNER TO salesos_outbox;
REVOKE ALL ON FUNCTION public.list_pending_outbox(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_pending_outbox(integer) FROM salesos_app;
GRANT EXECUTE ON FUNCTION public.list_pending_outbox(integer) TO salesos_worker;
