-- Sprint 6.2: a connection generation that invalidates a provider response
-- captured before disconnect, access revocation, or lease replacement.
-- Recovery: ALTER TABLE public.mailbox_connections DROP COLUMN revocation_version;

ALTER TABLE public.mailbox_connections
  ADD COLUMN revocation_version integer NOT NULL DEFAULT 0;
