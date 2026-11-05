-- Assignment and membership changes share one lock order:
-- advisory lock on the tenant, then FOR UPDATE on the tenant, user, and membership.
-- When a member, user, or organization leaves ACTIVE, open assignments end and
-- the current owner is cleared. Human takeover rows are not changed.
-- salesos_app still cannot read users, memberships, or tenants.
-- Recovery: DROP TRIGGER IF EXISTS end_inactive_member_ownership ON public.memberships;
-- DROP TRIGGER IF EXISTS end_inactive_user_ownership ON public.users;
-- DROP TRIGGER IF EXISTS end_inactive_tenant_ownership ON public.tenants;
-- DROP FUNCTION public.end_inactive_member_ownership();
-- DROP FUNCTION public.end_inactive_user_ownership();
-- DROP FUNCTION public.end_inactive_tenant_ownership();
-- DROP FUNCTION public.end_member_ownership(uuid, uuid);
-- DROP FUNCTION public.lock_member_for_assignment(uuid, uuid);
-- DROP TABLE public.crm_work_leases;

GRANT UPDATE ON TABLE public.tenants, public.users, public.memberships TO salesos_directory;
GRANT SELECT, UPDATE ON TABLE
  public.crm_leads, public.crm_accounts, public.crm_contacts, public.crm_assignments
TO salesos_directory;

CREATE OR REPLACE FUNCTION public.lock_member_for_assignment(target_tenant uuid, target_user uuid)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $body$
BEGIN
  PERFORM 1 FROM public.tenants WHERE id = target_tenant FOR UPDATE;
  PERFORM 1 FROM public.users WHERE id = target_user FOR UPDATE;
  PERFORM 1 FROM public.memberships WHERE tenant_id = target_tenant AND user_id = target_user FOR UPDATE;
  RETURN public.member_is_assignable(target_tenant, target_user);
END;
$body$;

ALTER FUNCTION public.lock_member_for_assignment(uuid, uuid) OWNER TO salesos_directory;
REVOKE ALL ON FUNCTION public.lock_member_for_assignment(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lock_member_for_assignment(uuid, uuid) TO salesos_app, salesos_worker;

CREATE OR REPLACE FUNCTION public.end_member_ownership(target_tenant uuid, target_user uuid)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $body$
BEGIN
  UPDATE public.crm_assignments
     SET ended_at = pg_catalog.now()
   WHERE tenant_id = target_tenant
     AND owner_user_id = target_user
     AND ended_at IS NULL;
  UPDATE public.crm_leads
     SET owner_user_id = NULL
   WHERE tenant_id = target_tenant
     AND owner_user_id = target_user;
  UPDATE public.crm_accounts
     SET owner_user_id = NULL
   WHERE tenant_id = target_tenant
     AND owner_user_id = target_user;
  UPDATE public.crm_contacts
     SET owner_user_id = NULL
   WHERE tenant_id = target_tenant
     AND owner_user_id = target_user;
END;
$body$;

ALTER FUNCTION public.end_member_ownership(uuid, uuid) OWNER TO salesos_directory;
REVOKE ALL ON FUNCTION public.end_member_ownership(uuid, uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.end_inactive_member_ownership()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $body$
BEGIN
  IF OLD.status = 'ACTIVE' AND NEW.status IS DISTINCT FROM 'ACTIVE' THEN
    PERFORM public.end_member_ownership(NEW.tenant_id, NEW.user_id);
  END IF;
  RETURN NEW;
END;
$body$;

ALTER FUNCTION public.end_inactive_member_ownership() OWNER TO salesos_directory;
REVOKE ALL ON FUNCTION public.end_inactive_member_ownership() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.end_inactive_member_ownership() TO salesos_identity;

DROP TRIGGER IF EXISTS end_inactive_member_ownership ON public.memberships;
CREATE TRIGGER end_inactive_member_ownership
AFTER UPDATE OF status ON public.memberships
FOR EACH ROW
EXECUTE FUNCTION public.end_inactive_member_ownership();

CREATE OR REPLACE FUNCTION public.end_inactive_user_ownership()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $body$
DECLARE
  membership record;
BEGIN
  IF OLD.status = 'ACTIVE' AND NEW.status IS DISTINCT FROM 'ACTIVE' THEN
    FOR membership IN SELECT tenant_id FROM public.memberships WHERE user_id = NEW.id
    LOOP
      PERFORM public.end_member_ownership(membership.tenant_id, NEW.id);
    END LOOP;
  END IF;
  RETURN NEW;
END;
$body$;

ALTER FUNCTION public.end_inactive_user_ownership() OWNER TO salesos_directory;
REVOKE ALL ON FUNCTION public.end_inactive_user_ownership() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.end_inactive_user_ownership() TO salesos_identity;

DROP TRIGGER IF EXISTS end_inactive_user_ownership ON public.users;
CREATE TRIGGER end_inactive_user_ownership
AFTER UPDATE OF status ON public.users
FOR EACH ROW
EXECUTE FUNCTION public.end_inactive_user_ownership();

CREATE OR REPLACE FUNCTION public.end_inactive_tenant_ownership()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $body$
BEGIN
  IF OLD.status = 'ACTIVE' AND NEW.status IS DISTINCT FROM 'ACTIVE' THEN
    UPDATE public.crm_assignments
       SET ended_at = pg_catalog.now()
     WHERE tenant_id = NEW.id
       AND ended_at IS NULL;
    UPDATE public.crm_leads SET owner_user_id = NULL WHERE tenant_id = NEW.id AND owner_user_id IS NOT NULL;
    UPDATE public.crm_accounts SET owner_user_id = NULL WHERE tenant_id = NEW.id AND owner_user_id IS NOT NULL;
    UPDATE public.crm_contacts SET owner_user_id = NULL WHERE tenant_id = NEW.id AND owner_user_id IS NOT NULL;
  END IF;
  RETURN NEW;
END;
$body$;

ALTER FUNCTION public.end_inactive_tenant_ownership() OWNER TO salesos_directory;
REVOKE ALL ON FUNCTION public.end_inactive_tenant_ownership() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.end_inactive_tenant_ownership() TO salesos_identity;

DROP TRIGGER IF EXISTS end_inactive_tenant_ownership ON public.tenants;
CREATE TRIGGER end_inactive_tenant_ownership
AFTER UPDATE OF status ON public.tenants
FOR EACH ROW
EXECUTE FUNCTION public.end_inactive_tenant_ownership();

CREATE TABLE public.crm_work_leases (
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  kind text NOT NULL,
  record_id uuid NOT NULL,
  lease_token text,
  lease_until timestamptz,
  lease_version integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'OPEN',
  PRIMARY KEY (tenant_id, kind, record_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.crm_work_leases TO salesos_app, salesos_worker;
ALTER TABLE public.crm_work_leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_work_leases FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.crm_work_leases;
CREATE POLICY tenant_isolation ON public.crm_work_leases
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
