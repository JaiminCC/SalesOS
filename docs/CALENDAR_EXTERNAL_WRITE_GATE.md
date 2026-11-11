# Calendar external write gate

`packages/integrations/src/calendar-write.ts` defines `createExternalEvent`, `updateExternalEvent`, `deleteExternalEvent`, `createConference`, and `sendCalendarInvitation`. Each throws `CalendarWriteClosed` with code `CALENDAR_EXTERNAL_WRITE_NOT_AUTHORIZED` as its first statement. The file does not call `fetch` and does not name a provider host.

`SALESOS_LIVE_CALENDAR_WRITE_ENABLED` defaults to `false`. `parseApiEnv` rejects `true` when `NODE_ENV` is `test` or `CI` is `true`. Playwright forces the variable false. No management route sets it. `UnconfiguredCalendar.book` throws the same closed error. The database check constraints keep `write_enabled` false and `provider_event_id` null.

Setting the environment variable true does not open the adapter. The throw happens before a URL exists. Google `events.insert`, `events.update`, `events.delete`, conference `createRequest`, and `sendUpdates` are not called. Microsoft event create, update, delete, `transactionId`, and online-meeting creation are not called. Provider event creation can notify attendees, so this sprint does not use event creation as a probe.

Future reconciliation states `PROVIDER_REQUEST_RESERVED`, `PROVIDER_ACCEPTED`, `OUTCOME_UNKNOWN`, `PROVIDER_CONFIRMED`, `RECONCILED`, and `FAILED` are not insertable. Sprint 11 can store `NOT_ATTEMPTED` and `CLOSED_GATE` only. A local confirmation stores `CLOSED_GATE` and a correlation id. It does not invent a provider event id.
