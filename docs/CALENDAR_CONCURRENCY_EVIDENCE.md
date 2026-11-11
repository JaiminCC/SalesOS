# Calendar concurrency evidence

## Protocol

Every hold, confirm, create-from-hold, reschedule, organizer reassignment, expire, and cancel path locks the organizer with `pg_advisory_xact_lock(hashtext(tenant_id || ':' || organizer_id))` inside `withTenant`, then re-reads and asserts free intervals before mutating.

Forward-only trigger `calendar_reject_overlap` on `calendar_holds` and `calendar_meetings` raises `SLOT_CONFLICT` when active holds or `BOOKED_INTERNAL` meetings overlap for the same organizer. A booking may share the interval with its own hold. Migration `20261108150000_calendar` was not edited after application.

## Two-session proof

`packages/database/src/calendar-work.spec.ts` opens independent Prisma clients (`left`, `right`) against the app and worker database URLs and races:

1. Concurrent `holdSlot` for the same organizer and local start → exactly one fulfills.
2. Concurrent `createInternalMeeting` on the winning hold → exactly one fulfills (`HOLD_REUSED` / conflict otherwise).
3. Concurrent `confirmMeeting` → exactly one `BOOKED_INTERNAL` and one `CLOSED_GATE` external link without a provider event id.
4. Concurrent identical `rescheduleMeeting` → exactly one succeeds.
5. Two booked meetings racing onto the same target slot → exactly one succeeds with `SLOT_CONFLICT` on the other.
6. Organizer reassignment onto a host that already holds the interval → `SLOT_CONFLICT`.
7. Confirm versus expire on the same hold → mutually exclusive terminal states.
8. Confirm versus cancel → one terminal state; external link only if booked.
9. Duplicate `processCalendarJob` after expiration → second pass expires `0`.
10. Raw SQL double-insert of overlapping holds → database trigger rejects the second with `SLOT_CONFLICT`.

Frontend conflict checks are not the authority. The database lock and trigger are.
