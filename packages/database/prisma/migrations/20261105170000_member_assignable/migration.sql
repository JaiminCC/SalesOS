-- A boolean membership check for record assignment.
-- salesos_directory already bypasses RLS so one user's memberships can be
-- read without granting salesos_app SELECT on users, memberships, or tenants.
-- The function returns only true or false for the tenant and user it is given.
-- Recovery: DROP FUNCTION public.member_is_assignable(uuid, uuid);

GRANT SELECT ON TABLE public.users TO salesos_directory;

CREATE OR REPLACE FUNCTION public.member_is_assignable(target_tenant uuid, target_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $body$
  SELECT EXISTS (
    SELECT 1
    FROM public.users AS account
    JOIN public.memberships AS membership
      ON membership.user_id = account.id
     AND membership.tenant_id = target_tenant
    JOIN public.tenants AS tenant
      ON tenant.id = membership.tenant_id
    WHERE account.id = target_user
      AND account.status = 'ACTIVE'
      AND membership.status = 'ACTIVE'
      AND tenant.status = 'ACTIVE'
  );
$body$;

ALTER FUNCTION public.member_is_assignable(uuid, uuid) OWNER TO salesos_directory;
REVOKE ALL ON FUNCTION public.member_is_assignable(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.member_is_assignable(uuid, uuid) TO salesos_app;
GRANT EXECUTE ON FUNCTION public.member_is_assignable(uuid, uuid) TO salesos_worker;
