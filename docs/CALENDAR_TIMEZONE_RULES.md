# Calendar time zone rules

Booked instants are UTC. The zone id is stored beside them. Conversion uses `Intl.DateTimeFormat` with `hourCycle: h23`. No phone number or email domain selects a zone.

`zonedLocalToUtc` returns `INVALID` for a bad zone or clock, `NONEXISTENT` when the wall time is skipped, and `AMBIGUOUS` when more than one UTC instant has that wall time. Ambiguous times are not offered and are not guessed. The caller must choose another local time.

Covered by `packages/shared/src/calendar.spec.ts`: Asia/Kolkata `2026-01-15T10:00` is `2026-01-15T04:30:00.000Z`. America/New_York `2026-03-08T02:30` is nonexistent. America/New_York `2026-11-01T01:30` is ambiguous. Europe/London `2026-03-29T01:30` is nonexistent. Intervals are half-open.
