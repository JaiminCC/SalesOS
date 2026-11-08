# Sequence scheduling

Wait times use an IANA time zone. `waitUntil` adds an absolute duration, so a daylight-saving spring-forward changes the local hour and not the elapsed UTC time. `addBusinessDays` counts weekdays in that zone. An invalid zone is rejected. An unknown recipient zone does not get a guessed local time. Quiet hours then return `UNKNOWN`.

A future wait writes `campaign_step_executions.scheduled_for` and a `campaign_schedules` row with status `WAITING`. The same step key does not create a second execution. When a later advance finds that row due, it completes the wait or stops the enrollment if suppression, takeover, or another stop rule is now true.

Once a minute the worker calls `list_due_campaign_schedules()`. For each due simulating run it inserts one pending `campaign.enrollment.advance.v1` outbox event if one is not already pending. The job advances at most 12 ready steps. A wait that is still in the future stops that loop. The function returns no row unless `live_delivery` is false and `sending_status` is `NOT_AUTHORIZED`.
