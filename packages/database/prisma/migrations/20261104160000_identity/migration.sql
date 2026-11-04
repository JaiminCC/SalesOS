-- Identity tables and a least-privilege login for authentication.
-- salesos_identity is created by pnpm db:role. It does not bypass RLS.
-- salesos_directory is NOLOGIN and BYPASSRLS only so list_user_memberships
-- can return one user's memberships across tenants.
-- salesos_app still cannot read users, sessions, or tokens.
-- Recovery: docs/AUTHENTICATION_ARCHITECTURE.md. Do not grant list_user_memberships to salesos_app.

DO $body$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'salesos_identity') THEN
    RAISE EXCEPTION 'salesos_identity is missing. Run pnpm db:role before pnpm db:migrate';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'salesos_directory') THEN
    CREATE ROLE salesos_directory NOLOGIN NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE;
  ELSE
    ALTER ROLE salesos_directory WITH NOLOGIN NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END
$body$;

ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS remember boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS active_tenant_id uuid;

CREATE TABLE IF NOT EXISTS public.email_verification_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz(6) NOT NULL,
  used_at timestamptz(6),
  created_at timestamptz(6) NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.invitations (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  email_hmac text NOT NULL,
  role_name text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz(6) NOT NULL,
  accepted_at timestamptz(6),
  revoked_at timestamptz(6),
  invited_by uuid,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS invitations_tenant_email_idx ON public.invitations (tenant_id, email_hmac);

CREATE TABLE IF NOT EXISTS public.security_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid,
  action text NOT NULL,
  result text NOT NULL,
  request_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz(6) NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS security_events_created_idx ON public.security_events (created_at);

CREATE TABLE IF NOT EXISTS public.captured_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  recipient_hmac text NOT NULL,
  token text NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS captured_messages_recipient_idx ON public.captured_messages (recipient_hmac, created_at);

ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invitations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.invitations;
CREATE POLICY tenant_isolation ON public.invitations
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

GRANT USAGE ON SCHEMA public TO salesos_identity;
GRANT USAGE ON SCHEMA public TO salesos_directory;

GRANT SELECT ON TABLE public.tenants, public.memberships, public.roles, public.membership_roles, public.invitations TO salesos_directory;

GRANT SELECT, INSERT, UPDATE ON TABLE
  public.users,
  public.sessions,
  public.password_reset_tokens,
  public.email_verification_tokens,
  public.auth_attempts,
  public.security_events,
  public.captured_messages,
  public.tenants
TO salesos_identity;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.memberships,
  public.roles,
  public.role_permissions,
  public.membership_roles,
  public.invitations
TO salesos_identity;

GRANT SELECT, INSERT ON TABLE public.audit_events TO salesos_identity;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.invitations TO salesos_app;

REVOKE ALL ON TABLE
  public.users,
  public.sessions,
  public.password_reset_tokens,
  public.email_verification_tokens,
  public.auth_attempts,
  public.security_events,
  public.captured_messages,
  public.tenants
FROM salesos_app;

REVOKE ALL ON TABLE
  public.users,
  public.sessions,
  public.password_reset_tokens,
  public.email_verification_tokens,
  public.auth_attempts,
  public.security_events,
  public.captured_messages,
  public.tenants
FROM salesos_worker;

CREATE OR REPLACE FUNCTION public.list_user_memberships(target_user uuid)
RETURNS TABLE (
  tenant_id uuid,
  tenant_name text,
  tenant_slug text,
  tenant_status text,
  membership_status text,
  role_name text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $body$
  SELECT tenant.id, tenant.name, tenant.slug, tenant.status, membership.status, role.name
  FROM public.memberships AS membership
  JOIN public.tenants AS tenant ON tenant.id = membership.tenant_id
  LEFT JOIN public.membership_roles AS member_role
    ON member_role.tenant_id = membership.tenant_id
   AND member_role.user_id = membership.user_id
  LEFT JOIN public.roles AS role
    ON role.tenant_id = member_role.tenant_id
   AND role.id = member_role.role_id
  WHERE membership.user_id = target_user;
$body$;

ALTER FUNCTION public.list_user_memberships(uuid) OWNER TO salesos_directory;
REVOKE ALL ON FUNCTION public.list_user_memberships(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_user_memberships(uuid) FROM salesos_app;
REVOKE ALL ON FUNCTION public.list_user_memberships(uuid) FROM salesos_worker;
CREATE OR REPLACE FUNCTION public.lookup_invitation(target_hash text)
RETURNS TABLE (
  tenant_id uuid,
  id uuid,
  email_hmac text,
  role_name text,
  expires_at timestamptz,
  accepted_at timestamptz,
  revoked_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $body$
  SELECT invitation.tenant_id, invitation.id, invitation.email_hmac, invitation.role_name,
         invitation.expires_at, invitation.accepted_at, invitation.revoked_at
  FROM public.invitations AS invitation
  WHERE invitation.token_hash = target_hash
  LIMIT 1;
$body$;

ALTER FUNCTION public.lookup_invitation(text) OWNER TO salesos_directory;
REVOKE ALL ON FUNCTION public.lookup_invitation(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.lookup_invitation(text) FROM salesos_app;
REVOKE ALL ON FUNCTION public.lookup_invitation(text) FROM salesos_worker;
GRANT EXECUTE ON FUNCTION public.lookup_invitation(text) TO salesos_identity;
GRANT EXECUTE ON FUNCTION public.list_user_memberships(uuid) TO salesos_identity;
GRANT EXECUTE ON FUNCTION public.tenant_is_active(uuid) TO salesos_identity;
