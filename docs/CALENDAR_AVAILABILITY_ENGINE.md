# Calendar availability engine

`suggestSlots` walks working-hour windows in the organizer zone. It skips blocked dates, nonexistent local times, ambiguous local times, notice, and horizon. A candidate is removed when its buffered interval overlaps `BUSY`, `TENTATIVE`, `OUT_OF_OFFICE`, or `WORKING_ELSEWHERE`. Overlap with `UNKNOWN` removes the slot rather than marking it free. The range is refused above 31 days. At most 48 slots are returned.

`LOCAL_ONLY` uses SalesOS rules and internal rows. `PROVIDER_VALIDATED` is returned only when a connection is already `READ_ACCESS_VERIFIED`. Sprint 11 never sets that readiness from a fixture, so a provider-validated request returns `NEEDS_PROVIDER_VERIFICATION` and an empty list. A disconnected calendar is not treated as free.

Google busy intervals map to `BUSY`. Graph `busy`, `tentative`, `oof`, and `workingElsewhere` keep those names. Anything else is `UNKNOWN`.
