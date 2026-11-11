-- Forward-only overlap guard. The applied calendar migration is unchanged.
-- Active holds and internal bookings for one organizer cannot overlap.
-- A booking may occupy the same interval as its own hold.

CREATE OR REPLACE FUNCTION public.calendar_reject_overlap()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_TABLE_NAME = 'calendar_holds' THEN
    IF NEW.status NOT IN ('HELD', 'CONFIRMED') OR NEW.expires_at <= pg_catalog.now() THEN
      RETURN NEW;
    END IF;
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(NEW.tenant_id::text || ':' || NEW.organizer_id::text));
    IF EXISTS (
      SELECT 1 FROM public.calendar_holds AS hold
      WHERE hold.tenant_id = NEW.tenant_id
        AND hold.organizer_id = NEW.organizer_id
        AND hold.id <> NEW.id
        AND hold.status IN ('HELD', 'CONFIRMED')
        AND hold.expires_at > pg_catalog.now()
        AND hold.start_at < NEW.end_at
        AND hold.end_at > NEW.start_at
    ) OR EXISTS (
      SELECT 1 FROM public.calendar_meetings AS meeting
      WHERE meeting.tenant_id = NEW.tenant_id
        AND meeting.organizer_id = NEW.organizer_id
        AND meeting.state = 'BOOKED_INTERNAL'
        AND meeting.hold_id IS DISTINCT FROM NEW.id
        AND meeting.start_at < NEW.end_at
        AND meeting.end_at > NEW.start_at
    ) THEN
      RAISE EXCEPTION 'SLOT_CONFLICT' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.state <> 'BOOKED_INTERNAL' THEN
    RETURN NEW;
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(NEW.tenant_id::text || ':' || NEW.organizer_id::text));
  IF EXISTS (
    SELECT 1 FROM public.calendar_meetings AS meeting
    WHERE meeting.tenant_id = NEW.tenant_id
      AND meeting.organizer_id = NEW.organizer_id
      AND meeting.id <> NEW.id
      AND meeting.state = 'BOOKED_INTERNAL'
      AND meeting.start_at < NEW.end_at
      AND meeting.end_at > NEW.start_at
  ) OR EXISTS (
    SELECT 1 FROM public.calendar_holds AS hold
    WHERE hold.tenant_id = NEW.tenant_id
      AND hold.organizer_id = NEW.organizer_id
      AND hold.status IN ('HELD', 'CONFIRMED')
      AND hold.expires_at > pg_catalog.now()
      AND hold.id IS DISTINCT FROM NEW.hold_id
      AND hold.start_at < NEW.end_at
      AND hold.end_at > NEW.start_at
  ) THEN
    RAISE EXCEPTION 'SLOT_CONFLICT' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.calendar_reject_overlap() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.calendar_reject_overlap() TO salesos_app, salesos_worker;

DROP TRIGGER IF EXISTS calendar_holds_overlap ON public.calendar_holds;
CREATE TRIGGER calendar_holds_overlap
  BEFORE INSERT OR UPDATE ON public.calendar_holds
  FOR EACH ROW EXECUTE FUNCTION public.calendar_reject_overlap();

DROP TRIGGER IF EXISTS calendar_meetings_overlap ON public.calendar_meetings;
CREATE TRIGGER calendar_meetings_overlap
  BEFORE INSERT OR UPDATE ON public.calendar_meetings
  FOR EACH ROW EXECUTE FUNCTION public.calendar_reject_overlap();
