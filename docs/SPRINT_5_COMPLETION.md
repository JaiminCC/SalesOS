# Sprint 5 completion

Signed-in Lead Discovery now reads and writes PostgreSQL. The signed-out leads page stays the simulated demonstration. Campaigns, inbox, meetings, analytics, WhatsApp, and the other prototype pages stay simulated.

## What is live

- Companies, contacts, and product-specific leads, with archive instead of hard delete.
- Server pagination, search, an allowlisted sort, page size, row selection, and confirmed archive.
- Add, view, and edit through the existing navigation token. The URL stays `/workspace/leads` and does not contain a database id.
- CSV import with size and row limits, formula neutralization, duplicate-domain skip, row errors, idempotency, and retry.
- Discovery through `manual` and `test` only. Both are `live: false` and the screen says the test directory is not a live external source.
- Deterministic ICP scoring pinned to the published product version. History is appended. A human can override with a reason.
- Suppression, human takeover, consent unknown, and quiet hours. Unknown is not permission. Nothing is sent.

## What was verified

See `docs/SPRINT_5_TEST_RESULTS.md`. The fixture company scored 65/100, grade B. A suppressed contact and a human takeover were not eligible for automation. Cross-tenant reads returned nothing. Playwright completed the company, contact, lead, import, discovery, qualification, eligibility, assignment, and archive flow, and found no send button.

## What is not claimed

- No third-party discovery API was configured or called.
- Lead qualification in CI does not call Ollama. An optional model explanation exists and was not executed against Gemma in this sprint.
- The nine `lead.*` tools are registered. The default product supervisor plan does not run them. A local lead-tool result is `UNKNOWN` so generated text is not stored as a sourced fact.
- This sprint does not certify compliance with privacy or marketing law.

## Acceptance

**PARTIAL.** The CRM, import, deterministic qualification, eligibility, tenant isolation, and no-send paths are implemented and tested. Live model research for a lead, and a live external discovery source, were not run.
