# Sprint 9 security review

Campaign tables use the existing `tenant_isolation` policy with forced row-level security. Grants are limited to `salesos_app` and `salesos_worker`. `list_due_campaign_schedules` is security definer, owned by `salesos_directory`, with `search_path = pg_catalog`, and execute is revoked from public.

Segment filters do not become SQL. Sequence conditions do not become scripts. Template variables are an allowlist, and HTML and header characters are escaped. Preview omits email addresses. Lead rows are returned only to a caller who can read leads.

The author of a configuration approval cannot approve it. A frozen campaign cannot be edited. Suppression, takeover, unknown consent, and unknown quiet hours remain ineligible. A later suppression stops an enrollment that was already waiting. AI output is validated before it is stored as model text. Rejected text is not labeled as accepted model content.

Database checks reject every value of `sending_status` except `NOT_AUTHORIZED` and every value of `live_delivery` except false. Campaign source files do not call the provider send adapters. No campaign tool is registered for send. Worker campaign jobs do not consume send quota.

Residual limits: automated reply detection cannot see a mailbox that is not configured, so it fails closed by never treating silence as a reply. Audience evaluation refuses above 500 active leads with `AUDIENCE_LIMIT` and saves no partial snapshot. Template editing after version 1 is a new template rather than a mutation of a frozen version. Those limits do not open a send path.
