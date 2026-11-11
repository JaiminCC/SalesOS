# Microsoft Calendar integration

Checked against Microsoft Graph v1.0 `calendar: getSchedule` on 8 November 2026.

Read: `POST https://graph.microsoft.com/v1.0/me/calendar/getSchedule`. Least privileged delegated permission for a work or school account is `Calendars.ReadBasic`. Higher permissions are `Calendars.Read` and `Calendars.ReadWrite`. SalesOS requests only `Calendars.ReadBasic`. Personal Microsoft accounts are documented as not supported. Application permissions are not requested.

`findMeetingTimes` is not called. Slot generation stays in SalesOS. Graph schedule items can include a subject. The adapter keeps status and time only. `free` is dropped. `busy`, `tentative`, `oof`, and `workingElsewhere` block a slot. Any other status is `UNKNOWN`, and `UNKNOWN` is not free. Redirects and non-Graph hosts are refused.

Status: the adapter is STUB_TESTED. This workspace has no Microsoft OAuth client. LIVE MICROSOFT CALENDAR — NOT CONFIGURED. REAL FREE/BUSY — NOT TESTED.

Event create, update, delete, `transactionId`, and Teams meeting creation are NOT_AUTHORIZED.
