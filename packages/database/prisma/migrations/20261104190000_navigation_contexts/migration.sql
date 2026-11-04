CREATE TABLE public.navigation_contexts (
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL,
  user_id uuid NOT NULL,
  token_hash text NOT NULL,
  resource_type text NOT NULL,
  action text NOT NULL,
  resource_id uuid,
  parent_id uuid,
  resource_key text NOT NULL DEFAULT '',
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (token_hash)
);

CREATE INDEX navigation_contexts_session_idx ON public.navigation_contexts (session_id, revoked_at);

ALTER TABLE public.navigation_contexts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.navigation_contexts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.navigation_contexts;
CREATE POLICY tenant_isolation ON public.navigation_contexts
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.navigation_contexts TO salesos_identity;
REVOKE ALL ON TABLE public.navigation_contexts FROM salesos_app;
REVOKE ALL ON TABLE public.navigation_contexts FROM salesos_worker;

CREATE FUNCTION public.revoke_session_navigation(target_session uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog
AS $body$
  UPDATE public.navigation_contexts
  SET revoked_at = statement_timestamp()
  WHERE session_id = target_session
    AND revoked_at IS NULL;
$body$;

REVOKE ALL ON FUNCTION public.revoke_session_navigation(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.revoke_session_navigation(uuid) FROM salesos_app;
GRANT EXECUTE ON FUNCTION public.revoke_session_navigation(uuid) TO salesos_identity;
