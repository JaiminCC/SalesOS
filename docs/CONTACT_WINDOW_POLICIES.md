# Contact window policies

One `crm_contact_policies` row per organization stores an IANA time zone, weekdays as 0–6 with Sunday as 0, a start and end minute, holiday dates as `YYYY-MM-DD`, a minimum interval in hours, and a maximum number of attempts in the current period. The default window is Monday to Friday, 09:00 to 17:00, 24 hours between attempts, and 3 attempts. The time zone is empty until someone saves one.

`evaluateQuietHours` uses `Intl.DateTimeFormat` with that time zone and `hourCycle: 'h23'`. An empty time zone returns `UNKNOWN` / `TIMEZONE_UNKNOWN`. An invalid time zone returns `UNKNOWN` / `TIMEZONE_INVALID`. A configured holiday, a weekday outside the list, a minute outside the window, a too-recent prior attempt, or an attempt limit returns `BLOCK` with a specific reason. A time inside the window returns `ALLOW` / `WITHIN_WINDOW`.

The contact time zone is preferred. If the contact has none, the organization time zone is used. If both are empty, the result is `UNKNOWN`. The policy decision maps `BLOCK` to `BLOCK` / `QUIET_HOURS` and `UNKNOWN` to `REQUIRE_APPROVAL` / `QUIET_HOURS_UNKNOWN` for an external action. `ALLOW` does not send a message. Daylight-saving changes are handled by the IANA zone. The unit test uses `America/New_York` on Thursday 5 November 2026, on Thanksgiving 26 November 2026, and on Monday 9 March 2026 after the spring-forward Sunday.
