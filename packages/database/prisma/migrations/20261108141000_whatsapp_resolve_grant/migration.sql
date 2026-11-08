-- The phone resolver reads connection state across tenants.
-- Recovery: REVOKE SELECT ON TABLE public.whatsapp_connections FROM salesos_directory;

GRANT SELECT ON TABLE public.whatsapp_connections TO salesos_directory;
