# Sprint 2 completion

Sprint 2 adds real registration, login, logout, email verification, password reset, sessions, organizations, invitations, RBAC, and security audit records. Existing SalesOS screens stay in place. AI agents, WhatsApp, live campaigns, billing, and SAML were not implemented. The application is not production-ready.

## Files created

- `packages/database/prisma/migrations/20261104160000_identity/migration.sql`
- `apps/api/src/common/api.exception.ts`
- `apps/api/src/identity/` (controllers, guards, Argon2id passwords, cookie helper, CSRF, mail capture, integration tests)
- `apps/web/lib/auth-client.ts`
- `docs/openapi/identity.yaml`
- `docs/AUTHENTICATION_ARCHITECTURE.md`
- `docs/RBAC_PERMISSION_MATRIX.md`
- `docs/SESSION_SECURITY.md`
- `docs/SECURITY_TEST_RESULTS.md`
- `docs/SPRINT_2_COMPLETION.md`

## Files modified

- Prisma schema, tenant table list, field decryption, role setup, and seed owner assignment
- API module, environment, exception filter, CORS, and queue prefix
- Worker queue prefix and the Sprint 1.1 processor and recovery tests
- `apps/web/components/SalesOS.jsx`, `Enterprise.jsx`, and `next.config.mjs`
- `.env.example`, `.env.production.example`, and `pnpm-lock.yaml` (`argon2`)
- Shared permission catalog and `foundationQueueName`

`.env` is gitignored. It received a local `salesos_identity` password and was not printed. Commit `e51c0b3` already adds the CI identity variables and builds `@salesos/shared` before `db:seed`.

## Database migration

`pnpm db:role` created `salesos_identity`. `pnpm db:migrate` applied `20261104160000_identity` on `127.0.0.1:55433`. `pnpm db:seed` refreshed the demo tenants, including the `OWNER` role. No applied migration was edited.

New tables: `email_verification_tokens`, `invitations` (`FORCE ROW LEVEL SECURITY`), `security_events` (no `tenant_id` column), and `captured_messages`. `sessions` gained `remember` and `active_tenant_id`. Existing user, membership, role, reset, and `audit_events` tables were reused.

## API

`POST /api/v1/auth/register`, `login`, `logout`, `forgot-password`, `reset-password`, `verify-email`

`GET /api/v1/auth/me`, `me/permissions`, `sessions`

`DELETE /api/v1/auth/sessions/:id`

`POST /api/v1/organizations`, `GET /api/v1/organizations`, `GET` and `PATCH /api/v1/organizations/:id`

`POST /api/v1/organizations/:id/switch`, `invitations`, `owner-transfer`

`POST /api/v1/invitations/accept`

`GET /api/v1/organizations/:id/members`, `PATCH` and `DELETE .../members/:userId`

`GET /api/v1/organizations/:id/audit`

`GET /api/v1/roles`, `GET /api/v1/permissions`

The contract is `docs/openapi/identity.yaml`. Errors use the existing `{ error: { code, message }, meta }` envelope.

## Screens connected to the session

Login, registration, forgot password, and reset password call the API. The dashboard stays behind `GET /api/v1/auth/me`. The workspace selector calls organization switch. Users, roles, sessions, and audit logs read the active organization. Profile name and email come from the session. SSO and MFA remain on screen and do not sign the user in. Simulated CRM and AI data stay local and labeled SIMULATED.

## Known limitations

- No TOTP, SAML, or OIDC.
- Mail is captured in the database outside production. There is no external mailbox.
- Seeded demo owners have no password.
- CSRF is an origin allow-list plus `X-Salesos-Csrf`, not a separate CSRF cookie.
- Playwright drives the rendered forms in Chromium. See `docs/SPRINT_2_FINAL_VERIFICATION.md` and `docs/SPRINT_2_1_COMPLETION.md`. The Users list and the permission matrix read the active organization from the API.
- `salesos_directory` bypasses RLS only to serve the two identity lookup functions.
- AI sales behavior, WhatsApp, outbound campaigns, and billing are still simulated or absent.

## Start the application

```bash
pnpm infra:up
pnpm db:setup
pnpm dev:api
pnpm dev:worker
pnpm dev:web
```

Open the web origin listed in `WEB_ORIGIN` (by default `http://127.0.0.1:3000`). The API listens on `127.0.0.1:3001`. Register, open the captured verification token from `captured_messages`, then visit `/?verify=<token>` and sign in. Do not use `MAIL_MODE=capture` in production.

## Sprint 3 prerequisites

Sprint 3 in `docs/IMPLEMENTATION_PLAN.md` is product configuration and knowledge. It can use the organization id on the session and the `products.read` / `products.write` permissions. It still needs durable product versions and knowledge ingestion. Live agents, mailbox sending, WhatsApp, and campaigns stay out of scope until their own phases. External providers still need timeout reconciliation from the Sprint 1.1 readiness notes, and the six open dependency exceptions remain reviewable by 4 December 2026.
