# Sprint 11 final acceptance

## Local implementation: PASS

The calendar foundation and Sprint 11.1 closeout are accepted locally.

- Migration `20261108150000_calendar` applied and unchanged after application.
- Forward-only overlap guard `20261111100000_calendar_overlap` applied.
- Tenant RLS forced; holds and bookings serialize per organizer.
- Availability is labeled `LOCAL_ONLY` unless a real provider read is verified.
- Separate reviewer required; self-approval rejected.
- Confirmation creates a `CLOSED_GATE` external link without a provider event id.
- Closed-gate write adapters throw before network access even when `SALESOS_LIVE_CALENDAR_WRITE_ENABLED=true`.
- Signed-in Meetings screen is `CalendarDesk`.

## Real AI proposal

REAL AI PROPOSAL ACCEPTED. `gemma4:e4b` over local Ollama produced a grounded `LOCAL_ONLY` proposal. It was stored as a `DRAFT` for human review. Nothing was booked, sent, or written externally. See `docs/CALENDAR_AI_ACCEPTANCE.md`.

The Sprint 11 rejection had two causes. The validator required the prose phrase "local only" instead of reading the structured `availability` field. The required agenda phrase took the first three raw words of the knowledge excerpt, including stop words like "the". Both now use the same structured contract and the same phrase extraction in the prompt and the validator. Fenced JSON and `local only` spelling are normalized. URLs, prices, unknown slots, and external booking claims are still rejected.

A browser defect was also fixed. The proposal form called `preventDefault` after an `await`, so the browser reloaded the page after a successful save.

## Provider and external writes

- PROVIDER STUB_TESTED
- REAL PROVIDER NOT TESTED
- LIVE GOOGLE CALENDAR — NOT CONFIGURED
- LIVE MICROSOFT CALENDAR — NOT CONFIGURED
- REAL FREE/BUSY — NOT TESTED
- EXTERNAL EVENT CREATION — NOT AUTHORIZED
- CALENDAR INVITATIONS — NOT AUTHORIZED
- OAuth callback consumes single-use state and does **not** complete live code exchange. Token persistence is stub-tested as `CONNECTED_UNVERIFIED` only. `READ_ACCESS_VERIFIED` requires an actual authorized provider read.

## Known limits

No public booking link, no round-robin assignment, no live OAuth exchange, no live free/busy, no external writes.
