-- Keep scheduled reads eligible after a stub page, a rate limit, or a cursor recovery.
-- Recovery: restore the previous list_due_mailbox_connections body from 20261106013000_mailbox_operations.

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
    AND connection.status IN ('CONFIGURED_UNVERIFIED', 'SYNCED', 'SYNC_PARTIAL', 'STUB_SYNCED', 'RATE_LIMIT', 'CURSOR_RECOVERED')
    AND connection.sync_paused = false
    AND connection.sending_enabled = false
    AND connection.live = false;
$body$;

ALTER FUNCTION public.list_due_mailbox_connections() OWNER TO salesos_directory;
REVOKE ALL ON FUNCTION public.list_due_mailbox_connections() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_due_mailbox_connections() TO salesos_worker;
