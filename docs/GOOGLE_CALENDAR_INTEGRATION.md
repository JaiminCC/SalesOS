# Google Calendar integration

Checked against the Calendar API v3 freeBusy reference, last updated 2026-05-12 UTC.

Read: `POST https://www.googleapis.com/calendar/v3/freeBusy`. The documented free/busy scopes include `calendar.readonly`, `calendar`, `calendar.events.freebusy`, and `calendar.freebusy`. SalesOS requests `https://www.googleapis.com/auth/calendar.freebusy` and `https://www.googleapis.com/auth/calendar.calendarlist.readonly`. It does not request `calendar` or `calendar.events`.

The freeBusy response returns busy intervals and does not return event subjects. The adapter maps those intervals to `BUSY`. Redirects are refused. A non-allowlisted host is refused. HTTP 429 becomes `RATE_LIMITED`.

Status: the adapter is STUB_TESTED. This workspace has no Google OAuth client. LIVE GOOGLE CALENDAR — NOT CONFIGURED. REAL FREE/BUSY — NOT TESTED. A stubbed busy response is not `READ_ACCESS_VERIFIED`.

Writes, Meet links, and invitations are NOT_AUTHORIZED. See `docs/CALENDAR_EXTERNAL_WRITE_GATE.md`.
