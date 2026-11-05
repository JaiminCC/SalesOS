GRANT SELECT ON TABLE public.mailbox_connections TO salesos_directory;

CREATE OR REPLACE FUNCTION public.lookup_capture_connection(target uuid)
RETURNS TABLE (tenant_id uuid, connection_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $body$
  SELECT connection.tenant_id, connection.id
  FROM public.mailbox_connections AS connection
  WHERE connection.id = target
    AND connection.provider = 'capture'
    AND connection.status = 'CAPTURE'
  LIMIT 1;
$body$;

ALTER FUNCTION public.lookup_capture_connection(uuid) OWNER TO salesos_directory;
REVOKE ALL ON FUNCTION public.lookup_capture_connection(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lookup_capture_connection(uuid) TO salesos_app;

CREATE OR REPLACE FUNCTION public.list_due_mailbox_connections()
RETURNS TABLE (tenant_id uuid, connection_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $body$
  SELECT connection.tenant_id, connection.id
  FROM public.mailbox_connections AS connection
  WHERE connection.provider IN ('google', 'microsoft')
    AND connection.status IN ('CONFIGURED_UNVERIFIED', 'SYNCED')
    AND connection.sending_enabled = false
    AND connection.live = false;
$body$;

ALTER FUNCTION public.list_due_mailbox_connections() OWNER TO salesos_directory;
REVOKE ALL ON FUNCTION public.list_due_mailbox_connections() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_due_mailbox_connections() TO salesos_worker;
