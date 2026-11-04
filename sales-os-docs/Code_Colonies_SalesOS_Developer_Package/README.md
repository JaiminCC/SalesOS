# Code Colonies SalesOS — Developer handoff

## Contents
- `SalesOS_BRD_SRS_Architecture.docx` — full BRD/SRS/architecture, delivery plan, constraints, controls and acceptance cases.
- `SalesOS_BRD_SRS_Architecture.md` — editable source for doc generation and Git review.
- `schema.sql` — executable *reference* relational foundation and RLS template. **Not a complete migration/production authentication implementation.**
- `openapi.yaml` — selected key REST routes and schemas. **Not exhaustive**: the full route inventory is in the specification; complete DTO and contract generation during implementation.
- `docker-compose.yml` — structure-only development/staging example; Dockerfiles are not supplied until project scaffold exists.

## First engineering activities
1. Review the scope and resolve architectural decision records.
2. Verify Contabo VPS compute/storage, current domain/mail services and available engineering FTEs.
3. Scaffold Next.js/NestJS/worker monorepo; configure strict TypeScript, lint, CI and test runners.
4. Convert `schema.sql` into migrations and enforce least-privilege app DB role. Test RLS context with pooled connections and workers.
5. Generate complete OpenAPI from NestJS DTOs and ensure runtime and contract stay aligned.
6. Add provider interfaces; do not assume access to scraped platforms or free unlimited search data.
7. Implement negative security and opt-out tests before enabling live outbound.

## Immediate deployment warning
The Compose example is intentionally *not* a production runnable stack because application source/Dockerfiles and secrets have not been created. Never expose PostgreSQL/Redis to the Internet. Do not use plaintext secrets for production; set reverse proxy, backups, monitoring and security reviews first.

## Design constraints
- One-time ₹100,000 incremental cash budget excludes current salaries and existing VPS costs.
- Human-reviewed outbound during MVP; policy-controlled automation only after demonstrated safety and legal review.
- Generic, multi-tenant system tested with two unrelated offering configurations.
- Never claim guaranteed leads or bookings.

## AI-first supervisor and meeting intelligence (mandatory MVP)
- SalesOS is a proactive autonomous **operator**, not a passive CRM. Event-driven supervisor watches connected inboxes, due tasks, stale leads, meetings, and failed jobs.
- Agent decisions are persisted as proposed typed actions and rechecked by deterministic policy gates before external side effects. Per-tenant pause switch stops outbound immediately.
- Meeting notes require a **lawfully authorized transcript** supplied by the meeting provider or uploaded by a user. No silent recording, invisible attendance, or invented meeting notes.
- Notes include evidence-backed requirements, decisions, objections, owners, due dates and confidence; uncertain assertions require review. Follow-up is drafted; externally sending it needs approval in the MVP.
- `schema.sql` and `openapi.yaml` contain selected additional reference tables/endpoints. Both require production implementation, migrations, DTOs, access-control tests and provider-specific permissions.
