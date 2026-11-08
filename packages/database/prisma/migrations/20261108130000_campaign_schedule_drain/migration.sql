-- Resume an internal campaign wait after its recorded time.
-- Recovery: DROP FUNCTION public.list_due_campaign_schedules();

CREATE FUNCTION public.list_due_campaign_schedules()
RETURNS TABLE (tenant_id uuid, run_id uuid, actor_user_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $body$
  SELECT DISTINCT ON (schedule.tenant_id, schedule.campaign_id)
    schedule.tenant_id,
    run.id,
    COALESCE(campaign.owner_user_id, campaign.created_by)
  FROM public.campaign_schedules AS schedule
  JOIN public.campaigns AS campaign
    ON campaign.tenant_id = schedule.tenant_id
   AND campaign.id = schedule.campaign_id
  JOIN public.campaign_runs AS run
    ON run.tenant_id = campaign.tenant_id
   AND run.campaign_id = campaign.id
  JOIN public.campaign_enrollments AS enrollment
    ON enrollment.tenant_id = schedule.tenant_id
   AND enrollment.id = schedule.enrollment_id
  WHERE schedule.status = 'WAITING'
    AND schedule.run_at <= CURRENT_TIMESTAMP
    AND campaign.state = 'SIMULATING'
    AND campaign.live_delivery = false
    AND campaign.sending_status = 'NOT_AUTHORIZED'
    AND enrollment.status = 'WAITING'
  ORDER BY schedule.tenant_id, schedule.campaign_id, run.created_at DESC;
$body$;

ALTER FUNCTION public.list_due_campaign_schedules() OWNER TO salesos_directory;
REVOKE ALL ON FUNCTION public.list_due_campaign_schedules() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_due_campaign_schedules() TO salesos_worker;
