# Calendar slot reservations

`holdSlot` locks `hashtext(tenantId:organizerId)` for the transaction, then rejects a half-open overlap with a `HELD` or `CONFIRMED` hold that has not expired, or with a `BOOKED_INTERNAL` meeting. The lock is PostgreSQL, not a browser check and not a Redis lock. Two concurrent requests produce one hold.

A hold expires after 15 minutes. `calendar.slot.hold.expire` marks due holds `EXPIRED`. Creating a meeting from an expired hold returns `HOLD_EXPIRED`. Confirmation locks again and rechecks the interval. A killed transaction before insert leaves no hold. A second delivery of the same interval conflicts instead of inserting another row.
