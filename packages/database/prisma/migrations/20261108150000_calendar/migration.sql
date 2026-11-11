-- Internal calendar foundation. External event creation stays unauthorized.
-- Recovery: drop the new tables in reverse dependency order.

CREATE TABLE public.calendar_connections (
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  display_name text NOT NULL,
  readiness text NOT NULL,
  granted_scopes text NOT NULL DEFAULT '',
  provider_subject text NOT NULL DEFAULT '',
  write_enabled boolean NOT NULL DEFAULT false,
  disabled_at timestamptz,
  revocation_version integer NOT NULL DEFAULT 1,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT calendar_connections_provider_check CHECK (provider IN ('GOOGLE_CALENDAR', 'MICROSOFT_CALENDAR')),
  CONSTRAINT calendar_connections_write_check CHECK (write_enabled = false),
  CONSTRAINT calendar_connections_readiness_check CHECK (readiness IN (
    'NOT_CONFIGURED', 'CONFIGURATION_INVALID', 'CONFIGURED_UNVERIFIED', 'AUTHORIZATION_REQUIRED',
    'CONNECTED_UNVERIFIED', 'READ_ACCESS_VERIFIED', 'SCOPE_MISSING', 'TOKEN_EXPIRED',
    'REAUTH_REQUIRED', 'DEGRADED', 'DISCONNECTED'
  ))
);

CREATE TABLE public.calendar_calendars (
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  connection_id uuid,
  organizer_id uuid NOT NULL,
  display_name text NOT NULL,
  time_zone text NOT NULL,
  provider_calendar_id text NOT NULL DEFAULT '',
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, connection_id) REFERENCES public.calendar_connections (tenant_id, id) ON DELETE SET NULL
);

CREATE TABLE public.calendar_credentials (
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL,
  ciphertext bytea NOT NULL,
  hint text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, connection_id) REFERENCES public.calendar_connections (tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE public.calendar_oauth_states (
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL,
  state_hash text NOT NULL UNIQUE,
  verifier_ciphertext bytea NOT NULL,
  redirect_uri text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, connection_id) REFERENCES public.calendar_connections (tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE public.calendar_rules (
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organizer_id uuid NOT NULL,
  time_zone text NOT NULL,
  working_hours jsonb NOT NULL,
  buffer_before_minutes integer NOT NULL DEFAULT 0,
  buffer_after_minutes integer NOT NULL DEFAULT 0,
  notice_minutes integer NOT NULL DEFAULT 60,
  horizon_days integer NOT NULL DEFAULT 14,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT calendar_rules_bounds_check CHECK (
    buffer_before_minutes BETWEEN 0 AND 240
    AND buffer_after_minutes BETWEEN 0 AND 240
    AND notice_minutes BETWEEN 0 AND 10080
    AND horizon_days BETWEEN 1 AND 60
  )
);

CREATE TABLE public.calendar_blocked_dates (
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organizer_id uuid NOT NULL,
  local_date date NOT NULL,
  reason text NOT NULL DEFAULT '',
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE public.calendar_meeting_types (
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  duration_minutes integer NOT NULL,
  location_type text NOT NULL,
  time_zone text NOT NULL,
  approval_required boolean NOT NULL DEFAULT true,
  active boolean NOT NULL DEFAULT true,
  archived_at timestamptz,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT calendar_types_duration_check CHECK (duration_minutes IN (15, 30, 45, 60, 90)),
  CONSTRAINT calendar_types_location_check CHECK (location_type IN ('VIRTUAL_PENDING', 'PHONE_CALL', 'PHYSICAL', 'OTHER'))
);

CREATE TABLE public.calendar_meeting_type_hosts (
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  meeting_type_id uuid NOT NULL,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, meeting_type_id) REFERENCES public.calendar_meeting_types (tenant_id, id) ON DELETE CASCADE,
  UNIQUE (tenant_id, meeting_type_id, user_id)
);

CREATE TABLE public.calendar_holds (
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organizer_id uuid NOT NULL,
  meeting_type_id uuid NOT NULL,
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  time_zone text NOT NULL,
  status text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, meeting_type_id) REFERENCES public.calendar_meeting_types (tenant_id, id),
  CONSTRAINT calendar_holds_status_check CHECK (status IN ('HELD', 'RELEASED', 'EXPIRED', 'CONFIRMED')),
  CONSTRAINT calendar_holds_interval_check CHECK (start_at < end_at)
);

CREATE TABLE public.calendar_meetings (
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  meeting_type_id uuid NOT NULL,
  organizer_id uuid NOT NULL,
  hold_id uuid,
  title text NOT NULL,
  agenda text NOT NULL DEFAULT '',
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  time_zone text NOT NULL,
  location_type text NOT NULL,
  state text NOT NULL,
  availability_mode text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  lead_id uuid,
  contact_id uuid,
  account_id uuid,
  source_kind text NOT NULL DEFAULT 'MANUAL',
  source_id uuid,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, meeting_type_id) REFERENCES public.calendar_meeting_types (tenant_id, id),
  CONSTRAINT calendar_meetings_state_check CHECK (state IN (
    'DRAFT', 'SLOT_HELD', 'PENDING_APPROVAL', 'APPROVED_INTERNAL', 'BOOKED_INTERNAL',
    'RESCHEDULE_REQUESTED', 'CANCELLED_INTERNAL', 'COMPLETED'
  )),
  CONSTRAINT calendar_meetings_mode_check CHECK (availability_mode IN ('LOCAL_ONLY', 'PROVIDER_VALIDATED')),
  CONSTRAINT calendar_meetings_location_check CHECK (location_type IN ('VIRTUAL_PENDING', 'PHONE_CALL', 'PHYSICAL', 'OTHER')),
  CONSTRAINT calendar_meetings_interval_check CHECK (start_at < end_at)
);

CREATE TABLE public.calendar_approvals (
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  meeting_id uuid NOT NULL,
  version integer NOT NULL,
  digest text NOT NULL,
  decision text NOT NULL,
  reviewer_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, meeting_id) REFERENCES public.calendar_meetings (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT calendar_approvals_decision_check CHECK (decision IN ('APPROVED', 'REJECTED'))
);

CREATE TABLE public.calendar_notes (
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  meeting_id uuid NOT NULL,
  body text NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, meeting_id) REFERENCES public.calendar_meetings (tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE public.calendar_outcomes (
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  meeting_id uuid NOT NULL,
  outcome text NOT NULL,
  note text NOT NULL DEFAULT '',
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, meeting_id) REFERENCES public.calendar_meetings (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT calendar_outcomes_check CHECK (outcome IN (
    'HELD', 'NO_SHOW', 'CANCELLED', 'RESCHEDULED', 'FOLLOW_UP_REQUIRED', 'QUALIFIED', 'NOT_QUALIFIED', 'UNKNOWN'
  ))
);

CREATE TABLE public.calendar_tasks (
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  meeting_id uuid NOT NULL,
  title text NOT NULL,
  due_on date,
  assignee_id uuid,
  status text NOT NULL DEFAULT 'OPEN',
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, meeting_id) REFERENCES public.calendar_meetings (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT calendar_tasks_status_check CHECK (status IN ('OPEN', 'DONE'))
);

CREATE TABLE public.calendar_activity (
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  meeting_id uuid,
  action text NOT NULL,
  actor_id uuid NOT NULL,
  detail text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE public.calendar_alerts (
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  code text NOT NULL,
  summary text NOT NULL,
  dedupe_key text NOT NULL,
  acknowledged_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, dedupe_key)
);

CREATE TABLE public.calendar_provider_errors (
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  connection_id uuid,
  code text NOT NULL,
  summary text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE public.calendar_verifications (
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL,
  evidence text NOT NULL,
  origin text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, connection_id) REFERENCES public.calendar_connections (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT calendar_verifications_origin_check CHECK (origin IN ('STUB_TESTED', 'LOCAL_CAPTURE'))
);

CREATE TABLE public.calendar_external_links (
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  meeting_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  state text NOT NULL,
  provider_event_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, meeting_id) REFERENCES public.calendar_meetings (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT calendar_external_state_check CHECK (state IN ('NOT_ATTEMPTED', 'CLOSED_GATE')),
  CONSTRAINT calendar_external_event_check CHECK (provider_event_id IS NULL)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.calendar_connections, public.calendar_calendars, public.calendar_credentials, public.calendar_oauth_states,
  public.calendar_rules, public.calendar_blocked_dates, public.calendar_meeting_types, public.calendar_meeting_type_hosts, public.calendar_holds,
  public.calendar_meetings, public.calendar_approvals, public.calendar_notes, public.calendar_outcomes,
  public.calendar_tasks, public.calendar_activity, public.calendar_alerts, public.calendar_provider_errors,
  public.calendar_verifications, public.calendar_external_links
TO salesos_app, salesos_worker;

DO $$
DECLARE name text;
BEGIN
  FOREACH name IN ARRAY ARRAY[
    'calendar_connections', 'calendar_calendars', 'calendar_credentials', 'calendar_oauth_states',
    'calendar_rules', 'calendar_blocked_dates', 'calendar_meeting_types', 'calendar_meeting_type_hosts', 'calendar_holds',
    'calendar_meetings', 'calendar_approvals', 'calendar_notes', 'calendar_outcomes',
    'calendar_tasks', 'calendar_activity', 'calendar_alerts', 'calendar_provider_errors',
    'calendar_verifications', 'calendar_external_links'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', name);
    EXECUTE format('CREATE POLICY tenant_isolation ON public.%I USING (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid) WITH CHECK (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)', name);
  END LOOP;
END $$;

INSERT INTO public.role_permissions (tenant_id, role_id, permission)
SELECT r.tenant_id, r.id, p.permission
FROM public.roles r
CROSS JOIN (VALUES
  ('calendar.connections.read'), ('calendar.connections.manage'),
  ('calendar.availability.read'), ('calendar.availability.manage'),
  ('calendar.meeting_types.read'), ('calendar.meeting_types.manage'),
  ('calendar.bookings.read'), ('calendar.bookings.create'), ('calendar.bookings.manage'), ('calendar.bookings.review'),
  ('calendar.meetings.read'), ('calendar.meetings.manage'), ('calendar.notes.manage'),
  ('calendar.operations.read'), ('calendar.analytics.read')
) AS p(permission)
WHERE r.name IN ('OWNER', 'ADMIN', 'Owner', 'Admin')
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (tenant_id, role_id, permission)
SELECT r.tenant_id, r.id, p.permission
FROM public.roles r
CROSS JOIN (VALUES
  ('calendar.connections.read'), ('calendar.availability.read'), ('calendar.availability.manage'),
  ('calendar.meeting_types.read'), ('calendar.meeting_types.manage'),
  ('calendar.bookings.read'), ('calendar.bookings.create'), ('calendar.bookings.manage'),
  ('calendar.meetings.read'), ('calendar.meetings.manage'),
  ('calendar.operations.read'), ('calendar.analytics.read')
) AS p(permission)
WHERE r.name IN ('SALES_MANAGER', 'Manager')
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (tenant_id, role_id, permission)
SELECT r.tenant_id, r.id, p.permission
FROM public.roles r
CROSS JOIN (VALUES
  ('calendar.bookings.read'), ('calendar.bookings.review'), ('calendar.meetings.read'), ('calendar.operations.read')
) AS p(permission)
WHERE r.name = 'Reviewer'
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (tenant_id, role_id, permission)
SELECT r.tenant_id, r.id, p.permission
FROM public.roles r
CROSS JOIN (VALUES
  ('calendar.meetings.read'), ('calendar.analytics.read'), ('calendar.operations.read')
) AS p(permission)
WHERE r.name IN ('Analyst', 'VIEWER')
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (tenant_id, role_id, permission)
SELECT r.tenant_id, r.id, p.permission
FROM public.roles r
CROSS JOIN (VALUES
  ('calendar.availability.read'), ('calendar.meeting_types.read'),
  ('calendar.bookings.read'), ('calendar.bookings.create'), ('calendar.meetings.read')
) AS p(permission)
WHERE r.name IN ('Sales', 'SALES_AGENT')
ON CONFLICT DO NOTHING;
