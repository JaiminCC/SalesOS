# Sprint 2 final verification

Executed on 4 November 2026 in the local workspace. Postgres is `127.0.0.1:55433`. Redis is `127.0.0.1:6379`. Playwright used an isolated database `salesos_e2e`, mail capture, and queue prefix `playwright`. The API tests used the development database and queue prefix `vitest`. No Sprint 3 feature was added. Nothing was committed or pushed.

## Commands

| Command | Exit | Result |
| --- | --- | --- |
| `pnpm lint` | 0 | Pass |
| `pnpm typecheck` | 0 | Pass |
| `pnpm test` | 0 after the scan fix below | 46 Vitest tests, then the web secret scan |
| `pnpm check:source` | 0 | Pass |
| `pnpm --filter @salesos/web build` | 0 | Next.js 15.5.29 compiled `/` and `/_not-found` |
| `pnpm test:e2e` | 0 | 1 Chromium test passed in 14.3s (test body 7.3s) |

The first `pnpm test` in this pass exited 1 at `apps/web` because `scripts/secret-scan.cjs` walks every `.ts` file under the web package and the new Playwright files name `DATABASE_URL` and `DATA_ENCRYPTION_KEY`. Those files run in Node and are not part of the browser bundle. The scanner now skips `e2e/`, the same way it already skips `scripts/`. `pnpm --filter @salesos/web test` then printed `PASS web source does not reference server secrets`.

Vitest counts in the run that reached every package: shared 4, agent-core 2, integrations 1, database 15, API 19, worker 5.

## Browser testing

Playwright `@playwright/test` 1.56.1 drives Chromium. macOS Screen Recording and Accessibility were not enabled. `apps/web/playwright.config.ts` starts its own API on `http://127.0.0.1:3021` and Next.js on `http://127.0.0.1:3020` with `reuseExistingServer: false`. Global setup drops and recreates `salesos_e2e`, grants connect to `salesos_app`, `salesos_worker`, and `salesos_identity`, then runs `prisma migrate deploy`. `MAIL_MODE=capture` and `SALESOS_QUEUE_PREFIX=playwright`. The test does not seed demo users. It registers its own accounts and reads tokens from `captured_messages`.

`apps/web/e2e/auth-flow.spec.ts` completed these rendered interactions with role and label selectors:

- Register a new user and see the local verification notice.
- Open `/?verify=` from the captured token and see the verified notice.
- Sign in and see the display name.
- Reload and still see the display name.
- Open Users & Roles and see the signed-in email on the live member row.
- Open Audit Logs and see `auth.login`.
- Sign out, load `/` again, and remain on the sign-in heading.
- Request a reset, open `/?reset=`, submit the new password, and sign in with it.
- Create a second organization and see it in Active workspace.
- Switch back to the first organization and see its name.
- Invite a second user.
- Register that user in a second browser context, open `/?invite=`, and switch into the inviting organization.
- See the owner's email on the members list.
- Submit an invitation as that member and see `You do not have permission for this action`.

Screenshots from that run:

- `docs/verification/signed-in.png`
- `docs/verification/users.png`
- `docs/verification/audit.png`
- `docs/verification/restricted-invite.png`

`docs/verification/users.png` shows one live account: Browser Owner, the registered email, role `OWNER`, status `ACTIVE`, and the API CONNECTED badge. The right-hand Roles & permission model table is still the existing demonstration grid. The browser assertion covers the live member row. It does not treat those checkboxes as server permissions.

## Authorization regression

`apps/api/src/identity/security.regression.spec.ts` passed four tests:

- Removing a membership returns 204, and the removed user's existing cookie then receives 401 for that organization.
- Downgrading `ADMIN` to `VIEWER` returns 204, the old cookie receives 401, and a new login omits `users.manage` and `roles.manage`.
- Suspending an organization returns 403 for a later read and for switch. Switching back to the still-active organization returns 204.
- Switching into an organization the caller does not belong to returns 403.
- User A's cookie cannot read User B's organization audit (`403`). User A can read User A's own audit (`200`).
- An admin assigning `OWNER` returns 403.
- Removing the last owner returns 409 `CONFLICT`.
- An invitation redeemed by a different signed-in email returns 403 and leaves `acceptedAt` null.
- Two live sessions exist. Parallel deletes of the second session return 204 or 404, the second cookie then receives 401, and the first cookie still receives 200.
- A session whose idle expiry or absolute expiry is already past receives 401.

`auth.integration.spec.ts` (7 tests) still covers registration, invalid credentials, Argon2id, reset expiry and reuse, session rotation, CSRF without the header, cross-tenant denial, two organizations, admin escalation, expired invitations, removed membership on a new login, throttling, missing tenant context, and pool leakage.

## Session and CSRF

Reviewed `session-cookie.ts`, `csrf.middleware.ts`, and the session fields used by `identity.service.ts`.

- Cookie `salesos_session` is `HttpOnly`, `SameSite=Lax`, `Path=/`. `Secure` is set only when `NODE_ENV=production`. The database stores the SHA-256 of the token.
- Login revokes the presented session and inserts a new row.
- Idle lifetime is 30 minutes and slides on use. Absolute lifetime is 12 hours, or 30 days with remember-me.
- Express `trust proxy` stays off. Throttling uses the socket address, not `X-Forwarded-For`.
- Cookie-authenticated `POST`, `PUT`, `PATCH`, and `DELETE` require `X-Salesos-Csrf: 1`. The cookie is detected with `readSessionCookie`.

The CSRF test sent a switch request and recorded:

| Request | Status |
| --- | --- |
| No `Origin`, header `X-Salesos-Csrf: 1` | 204 |
| `Origin: not a url` | 403 |
| `Origin: null` | 403 |
| `Origin: http://evil.example` | 403 |
| `Origin` equal to an allowed origin plus a path | 403 |
| Allowed `Origin`, no CSRF header | 403 |
| Allowed `Origin`, header value `no` | 403 |
| Allowed `Origin`, header `X-Salesos-Csrf: 1` | 204 |

This is adequate for the supported deployment. The browser calls the API through the same-origin `/backend` rewrite, `SameSite=Lax` withholds the cookie from cross-site form posts, and a browser cannot add `X-Salesos-Csrf` on a cross-origin request without a CORS preflight. A missing `Origin` is accepted only when the caller already presents the session cookie and the CSRF header. That is session possession for a non-browser client, not a cross-site browser request. The authentication system was not replaced.

## Concurrent security

The same regression file ran these in parallel:

- Eight wrong-password logins for one email. At most five were stored, at most five returned 401, and at least one returned 429. `recordAttempt` takes `pg_advisory_xact_lock(hashtextextended(email, 0))` and rejects before insert once the email has 5 failures in 15 minutes. A source address is capped at 100 so one shared test address does not lock later suites. Each auth suite deletes `auth_attempts` in `beforeAll`.
- Two accepts of one invitation. One returned 200 and one returned `TOKEN_USED`.
- Two owner transfers at once. Exactly one returned 204 and exactly one `OWNER` membership role remained.
- Two uses of one password-reset token. One returned 204 and one returned `TOKEN_USED`. Email verification uses the same conditional `updateMany`.
- Parallel reads across tenants. The invitee's cookie received 403 for the other organization's audit. A user from a different organization received 403 for the first organization's members. The transferred owner's old cookie received 401 because owner transfer revokes both users' sessions. The invitee's own session still returned 200.

## Regression preserved

Database tests passed forced RLS, `salesos_definer` ownership of `tenant_is_active`, worker-only `list_pending_outbox`, and the migration probe applying history twice. Worker tests passed outbox recovery and the fail-once retry. `pnpm check:source` still requires the existing SalesOS screen strings, including Audit, Session, Permission, and the simulated enterprise surfaces. The web production build completed. AI, WhatsApp, campaigns, and billing were not changed into live features.

## Defects found and fixed

- Password-reset, email-verification, and invitation tokens could be consumed twice under concurrent requests. Consume is now a conditional `updateMany` on an unused, unexpired hash. Invitation accept checks the signed-in email before that claim, so the wrong email does not burn the token.
- Concurrent owner transfers and last-owner removal could both pass a check-then-act read. Both paths take a tenant advisory lock inside `withTenant` and re-check the actor and the remaining owners.
- Concurrent failed logins could pass the email cap. Failures for one email are serialized in a transaction lock. The per-address cap was 20, which the security suite exhausted on `127.0.0.1` and then caused later logins in `auth.integration.spec.ts` to return 429. The address cap is 100. Suites clear attempt rows before they start.
- `PermissionGuard` returned false, so Nest responded with the generic message `Forbidden`. The users screen could not show a stable denial. The guard now throws `403 FORBIDDEN` with `You do not have permission for this action`.
- The register success notice was cleared before the login view rendered, and the reset button still said `Reset password (demo)`. The login view renders the notice, and the button says `Reset password`.
- The signed-in UI had no control to create an organization or to accept an invitation. Settings has New organization, and `/?invite=` accepts the token after sign-in.
- The web secret scan treated Playwright setup as client source. It now skips `e2e/`.

## Security findings

No confirmed CSRF bypass remains for the `/backend` deployment. Missing `Origin` with a valid session and CSRF header stays allowed on purpose.

Suspending an organization blocks later access, including the owner who suspended it. There is no separate unsuspend path that bypasses the active-tenant check. The owner can still use another active organization.

Role downgrade and membership removal revoke the affected sessions, so the next request with the old cookie is 401. A new login has the reduced permissions. That is immediate, and it also signs the user out of other devices.

`salesos_directory` remains `BYPASSRLS` and may execute only `list_user_memberships` and `lookup_invitation`. `salesos_app` still cannot read platform identity tables. `DATABASE_URL` remains the migration and test superuser. Ordinary tenant queries use `DATABASE_URL_APP`.

## Remaining limitations

- No TOTP, SAML, or OIDC. SSO and MFA screens do not create a session.
- Mail stays in `captured_messages` when `MAIL_MODE=capture`. Production boot still refuses that mode.
- Seeded Northstar and Sample Agency owners have no password.
- The Roles & permission model grid on Users & Roles is still demonstration data. Server enforcement is the API permission guard.
- Simulated CRM and AI behavior remain simulated.
- Playwright is not wired into `.github/workflows/ci.yml`.
- Trust proxy stays off. A deployment that terminates TLS on a proxy needs an explicit trusted-proxy design before throttling can use a forwarded client address.
- The open dependency exceptions are unchanged and remain reviewable by 4 December 2026.

## Acceptance matrix

| Check | Result |
| --- | --- |
| Register, verify email, sign in | PASS |
| Refresh keeps the session | PASS |
| Protected screens require a session | PASS |
| Logout returns the user to sign-in | PASS |
| Password reset request and completion | PASS |
| Create organization, invite, accept, switch workspace | PASS |
| Users list shows the live member | PASS |
| Roles permission grid shows live permissions | FAIL — grid is still the demonstration table |
| Audit shows `auth.login` | PASS |
| Unauthorized invite control is denied in the browser | PASS |
| Membership removal blocks the existing session | PASS |
| Role downgrade removes permissions on the next login | PASS |
| Suspended organization blocks access | PASS |
| Tenant switch cannot bypass membership | PASS |
| User A cannot read User B's audit | PASS |
| Tenant admin cannot grant OWNER | PASS |
| Last owner cannot be removed | PASS |
| Invitation cannot be redeemed by another email | PASS |
| Revocation affects the other device only | PASS |
| CSRF matrix for missing, malformed, foreign, and same-origin | PASS |
| Concurrent logins, invites, transfers, resets, and cross-tenant reads | PASS |
| Sprint 1.1 RLS, outbox, and worker tests | PASS |
| `pnpm lint`, `typecheck`, `check:source`, web build, Playwright | PASS |

Sprint 2 is accepted for authentication, organization membership, server RBAC, sessions, and the rendered browser flow. It is not accepted as a live roles-matrix editor, and it is not production-ready.
