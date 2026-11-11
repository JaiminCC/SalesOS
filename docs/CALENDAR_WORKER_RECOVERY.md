# Calendar worker recovery

## Jobs

Job names are `calendar.availability.refresh`, `calendar.slot.hold.expire`, `calendar.booking.prepare`, `calendar.booking.confirm_internal`, `calendar.booking.reschedule_internal`, `calendar.booking.cancel_internal`, `calendar.ai.proposal`, `calendar.ai.agenda`, `calendar.meeting.followup.prepare`, `calendar.connection.health`, and `calendar.analytics.aggregate`. The worker maps `calendar.*.v1` outbox events onto those names. Handlers expire due holds for an active member and never call a provider write, email send, or WhatsApp send.

## SIGKILL coverage (`apps/worker/src/calendar-kill.spec.ts`)

| Case | Result |
| --- | --- |
| A. Kill before hold | No hold row |
| B. Kill during hold transaction | Rollback; no hold |
| C. Kill after committed hold | Hold remains; replacement conflict on same slot |
| D. Kill during confirm | Stays `APPROVED_INTERNAL`; no external link |
| E. Kill after confirm commit | `BOOKED_INTERNAL` with `CLOSED_GATE` link; confirm retry conflicts |
| F. Kill during reschedule | Prior booking unchanged until replacement succeeds |
| G. Kill during expire | Hold remains `HELD` until replacement expires it |
| H. Duplicate job delivery | Second expire/process returns `expired: 0` |
| I. Replacement after committed hold | One active hold; second same-slot hold conflicts |
| J. Tenant suspension | `TENANT_SUSPENDED`; no further mutation |
| K. Membership / connection revocation | `AUTH_REVOKED` / `DISCONNECTED`; `externalWrites: 0` |

## Guarantees

- No duplicate or overlapping active bookings for one organizer.
- No lost committed hold/confirm when killed after commit.
- No stale overwrite across versioned updates.
- No unauthorized continuation when tenant or membership is revoked.
- No external provider writes.
