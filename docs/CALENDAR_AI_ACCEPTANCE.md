# Calendar AI acceptance

## Root cause of the Sprint 11 rejection

`gemma4:e4b` was invoked successfully over local Ollama HTTP. The earlier validator looked for the prose phrase `local only` instead of reading a structured `availability` field. The required agenda phrase was the first three raw words of the knowledge excerpt, including stop words, so it did not match natural agenda text. Both were validator and prompt contract defects. Neither was a fabricated booking.

## Fix (fail-closed)

- `calendar.agenda.propose` now uses a JSON output schema: `summary`, `agenda`, `slot`, `availability`.
- Prompt and stored facts require `availability=LOCAL_ONLY`, an exact preferred slot from internal availability, CRM account name in `summary`, and a grounded agenda phrase derived from approved knowledge (`requiredAgendaPhrase`).
- `acceptMeetingProposal` accepts only grounded structured proposals. Invented Meet/Teams URLs, prices, external booking claims, unknown slots, and non-`LOCAL_ONLY` availability still fail.
- Accepted proposals persist as `DRAFT` / `REVIEW_REQUIRED` with `sourceKind=AI_PROPOSAL`. No automatic confirm, no external event, no invitation, no email/WhatsApp send.

## Real Ollama acceptance criteria

Harness: `apps/api/src/calendar/calendar-model.acceptance.ts` (vitest acceptance, fictional CRM data).

Required outcomes when the model cooperates:

1. Real Ollama HTTP invocation
2. Correct model recorded (`gemma4:e4b`)
3. Real internal availability consulted
4. Valid available slot referenced
5. Grounded meeting agenda
6. Product/CRM context preserved
7. No invented external link
8. Proposal persisted
9. Proposal marked `REVIEW_REQUIRED`
10. No automatic booking confirmation
11. No external calendar event
12. No email/WhatsApp send
13. Model usage recorded

If the model still fails validation, record **REAL AI PROPOSAL ACCEPTANCE: FAIL or NOT VERIFIED**. Do not fabricate success.

## Status: REAL AI PROPOSAL ACCEPTED

Run on 2026-11-11 with `npx vitest run -c vitest.acceptance.config.ts src/calendar/calendar-model.acceptance.ts` from `apps/api`. Exit 0, 1 of 1 tests passed.

```
{"provider":"ollama","model":"gemma4:e4b","state":"SUCCEEDED","proposal":"REVIEW_REQUIRED","review":"REVIEW_REQUIRED","externalWrites":0}
```

The test asserted all 13 criteria. The run used local Ollama HTTP. Usage rows were recorded with provider `ollama` and model `gemma4:e4b`. The agenda passed `acceptMeetingProposal` against a slot from internal availability. The proposal was stored as `DRAFT`, `LOCAL_ONLY`, `AI_PROPOSAL`. The agenda contains the grounded knowledge phrase and has no Meet or Teams link. No `BOOKED_INTERNAL` meeting, external link row, or mailbox send attempt was created. The CRM lead stage was unchanged.

This result is for one model on one fictional fixture. A different model or prompt can still be rejected. The validator stays fail-closed.
