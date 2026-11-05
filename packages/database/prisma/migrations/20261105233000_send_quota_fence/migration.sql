ALTER TABLE public.email_send_policies
  ADD COLUMN user_hourly_cap integer NOT NULL DEFAULT 10,
  ADD COLUMN tenant_daily_cap integer NOT NULL DEFAULT 100,
  ADD COLUMN policy_revision integer NOT NULL DEFAULT 1;

ALTER TABLE public.mailbox_send_attempts
  ADD COLUMN revocation_version integer,
  ADD COLUMN policy_revision integer,
  ADD COLUMN payload_digest text,
  ADD COLUMN accepted_at timestamptz;

ALTER TABLE public.mailbox_draft_versions
  ADD COLUMN cc jsonb NOT NULL DEFAULT '[]',
  ADD COLUMN bcc jsonb NOT NULL DEFAULT '[]';

CREATE TABLE public.email_send_reservations (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  attempt_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  user_id uuid NOT NULL,
  draft_version_id uuid NOT NULL,
  state text NOT NULL,
  recipient_count integer NOT NULL,
  contact_key text NOT NULL DEFAULT '',
  hour_start timestamptz NOT NULL,
  day_start date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, draft_version_id),
  UNIQUE (tenant_id, attempt_id),
  FOREIGN KEY (tenant_id, attempt_id) REFERENCES public.mailbox_send_attempts (tenant_id, id) ON DELETE CASCADE
);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.email_send_reservations TO salesos_app, salesos_worker;

ALTER TABLE public.email_send_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_send_reservations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.email_send_reservations
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
