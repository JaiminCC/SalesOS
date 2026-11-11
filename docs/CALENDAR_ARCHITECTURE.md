# Calendar architecture

`CalendarDesk` calls `POST /api/v1/management/calendar/*` with the session and CSRF header. The API checks membership and a calendar permission, then `packages/database/src/calendar-work.ts` runs inside `withTenant`. Reads of provider busy time, when a future token exists, go through `packages/integrations/src/calendar-read.ts`. Writes go through `packages/integrations/src/calendar-write.ts`, which throws.

The slot algorithm is in `packages/shared/src/calendar.ts`. The worker publishes calendar outbox events and expires holds. The AI supervisor can run `MEETING_PREPARE_AND_SCHEDULE` without an external tool.

There is no public booking link. Sharing one would need expiry, revocation, purpose binding, tenant binding, rate limits, and bot protection, which are not part of this local acceptance.
