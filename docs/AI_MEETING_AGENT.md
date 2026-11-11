# AI meeting agent

Plan `MEETING_PREPARE_AND_SCHEDULE` has eleven internal tools: connection, availability, meeting type, slot suggest, slot validate, CRM context, product context, meeting propose, agenda propose, approval propose, and booking status. All have `external: false`. None is `calendar.event.create_external`, `calendar.invitation.send`, `calendar.meet.create`, or `calendar.teams.create`.

The initiator may hold `agents.manage` or `calendar.bookings.create`. Prompt text tells the model that meeting text is untrusted and that a local-only slot must be described as local only. `classifyMeetingIntent` always returns `REVIEW_REQUIRED`. “Book a meeting tomorrow” does not create `BOOKED_INTERNAL`.

`acceptMeetingProposal` rejects empty text, a Meet or Teams URL, or text that does not say the availability is local only. Rejected model output stays `REVIEW_REQUIRED` and is not stored as an accepted booking. Deterministic proposals are not labeled as Ollama. Real Ollama acceptance is recorded separately in `docs/SPRINT_11_TEST_RESULTS.md`.
