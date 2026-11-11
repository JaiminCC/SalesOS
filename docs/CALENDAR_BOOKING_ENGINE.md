# Calendar booking engine

Stored meeting states are `DRAFT`, `SLOT_HELD`, `PENDING_APPROVAL`, `APPROVED_INTERNAL`, `BOOKED_INTERNAL`, `RESCHEDULE_REQUESTED`, `CANCELLED_INTERNAL`, and `COMPLETED`. `EXTERNAL_SYNC_PENDING`, `EXTERNALLY_CONFIRMED`, and `EXTERNAL_OUTCOME_UNKNOWN` are not stored and cannot be reached by local simulation.

A hold creates `SLOT_HELD`. Submit moves it to `PENDING_APPROVAL` when the version matches. A different reviewer stores an approval digest and moves it to `APPROVED_INTERNAL`. Confirm moves it to `BOOKED_INTERNAL`, marks the hold `CONFIRMED`, and inserts `CLOSED_GATE`. That state is not externally confirmed. The response includes `conferenceUrl: null`.

Reschedule takes a new local time, releases the previous hold, and returns to `PENDING_APPROVAL` when the meeting type requires approval. Cancel releases the hold, stores the reason, and does not call a provider or send a notice. A retry of a conflicting transition returns `CONFLICT` rather than a second meeting.
