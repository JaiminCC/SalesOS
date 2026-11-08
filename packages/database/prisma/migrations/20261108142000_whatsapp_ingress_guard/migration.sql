-- Forward-only. Recovery: drop the three functions, then grant
-- SELECT, INSERT, UPDATE on whatsapp_ingress back to salesos_app and salesos_worker.

REVOKE ALL ON TABLE public.whatsapp_ingress FROM PUBLIC, salesos_app, salesos_worker;
GRANT SELECT, INSERT, UPDATE ON TABLE public.whatsapp_ingress TO salesos_directory;

CREATE FUNCTION public.whatsapp_ingress_by_key(lookup text)
RETURNS TABLE (id uuid, event_key text, provider_phone_id text, kind text, status text, origin text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $body$
  SELECT i.id, i.event_key, i.provider_phone_id, i.kind, i.status, i.origin
  FROM public.whatsapp_ingress AS i
  WHERE i.event_key = lookup
  LIMIT 1
$body$;

CREATE FUNCTION public.whatsapp_ingress_by_id(lookup uuid)
RETURNS TABLE (id uuid, event_key text, provider_phone_id text, kind text, status text, origin text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $body$
  SELECT i.id, i.event_key, i.provider_phone_id, i.kind, i.status, i.origin
  FROM public.whatsapp_ingress AS i
  WHERE i.id = lookup
  LIMIT 1
$body$;

CREATE FUNCTION public.whatsapp_ingress_insert(event_key text, provider_phone_id text, kind text, origin text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $body$
DECLARE
  new_id uuid;
BEGIN
  IF origin NOT IN ('STUB_TESTED', 'LOCAL_CAPTURE') THEN
    RAISE EXCEPTION 'invalid origin' USING ERRCODE = '23514';
  END IF;
  IF kind NOT IN ('message', 'status') THEN
    RAISE EXCEPTION 'invalid kind' USING ERRCODE = '23514';
  END IF;
  INSERT INTO public.whatsapp_ingress (event_key, provider_phone_id, kind, status, origin)
  VALUES (event_key, provider_phone_id, kind, 'RECEIVED', origin)
  RETURNING id INTO new_id;
  RETURN new_id;
EXCEPTION
  WHEN unique_violation THEN
    RETURN NULL;
END;
$body$;

CREATE FUNCTION public.whatsapp_ingress_set_status(ingress_id uuid, next_status text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $body$
BEGIN
  IF next_status NOT IN ('QUARANTINED', 'PROCESSED', 'DISABLED') THEN
    RAISE EXCEPTION 'invalid status' USING ERRCODE = '23514';
  END IF;
  UPDATE public.whatsapp_ingress
  SET status = next_status
  WHERE id = ingress_id;
END;
$body$;

ALTER FUNCTION public.whatsapp_ingress_by_key(text) OWNER TO salesos_directory;
ALTER FUNCTION public.whatsapp_ingress_by_id(uuid) OWNER TO salesos_directory;
ALTER FUNCTION public.whatsapp_ingress_insert(text, text, text, text) OWNER TO salesos_directory;
ALTER FUNCTION public.whatsapp_ingress_set_status(uuid, text) OWNER TO salesos_directory;

REVOKE ALL ON FUNCTION public.whatsapp_ingress_by_key(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.whatsapp_ingress_by_id(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.whatsapp_ingress_insert(text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.whatsapp_ingress_set_status(uuid, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.whatsapp_ingress_by_key(text) TO salesos_app, salesos_worker;
GRANT EXECUTE ON FUNCTION public.whatsapp_ingress_by_id(uuid) TO salesos_app, salesos_worker;
GRANT EXECUTE ON FUNCTION public.whatsapp_ingress_insert(text, text, text, text) TO salesos_app, salesos_worker;
GRANT EXECUTE ON FUNCTION public.whatsapp_ingress_set_status(uuid, text) TO salesos_app, salesos_worker;
