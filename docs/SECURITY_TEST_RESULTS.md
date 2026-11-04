# Security test results

Executed on 4 November 2026 in the local workspace. Postgres is `127.0.0.1:55433`. Redis is `127.0.0.1:6379`.

## Commands

| Command | Exit | Result |
| --- | --- | --- |
| `pnpm lint` | 0 | Pass |
| `pnpm typecheck` | 0 | Pass |
| `pnpm test` | 0 | 46 Vitest tests plus the web secret scan |
| `pnpm --filter @salesos/web build` | 0 | Pass |
| `pnpm check:source` | 0 | Pass |

Vitest counts after the final verification run: shared 4, agent-core 2, integrations 1, database 15, API 19, worker 5. The API file `security.regression.spec.ts` adds the four authorization, CSRF, expiry, and concurrency cases.

Migration `20261104160000_identity` applied on the local database before the suite. `pnpm db:role` created `salesos_identity`. The migration probe applied the full history twice on a clean database.

## Sprint 2 cases

| Case | Result |
| --- | --- |
| Successful registration | Pass. 202, user `PENDING_VERIFICATION`, verification token captured. |
| Invalid credentials | Pass. Unknown email, wrong password, and unverified user return `INVALID_CREDENTIALS`. |
| Password hashing | Pass. Stored hash starts with `$argon2id$` and does not contain the password. |
| Reset token expiration | Pass. `TOKEN_EXPIRED`. |
| Reset token reuse | Pass. First use 204, second `TOKEN_USED`. |
| Session rotation | Pass. The presented cookie is rejected after the next login. |
| Session revocation | Pass. `DELETE` returns 204 and the cookie then returns 401. |
| Unauthorized API access | Pass. `GET /api/v1/auth/me` without a cookie is 401. |
| Cross-tenant access denial | Pass. Another organization's id returns 403 for read and switch. |
| User in two organizations | Pass. Create plus list returns two memberships, and switch changes `organizationId`. |
| Unauthorized role escalation | Pass. An admin cannot assign `OWNER`. |
| Expired invitations | Pass. `TOKEN_EXPIRED`. |
| Removed membership | Pass. After removal, a new login cannot read that organization. |
| Missing database tenant context | Pass. `salesos_app` membership reads return no rows. |
| Connection-pool tenant leakage | Pass. A following query without `withTenant` returns no rows. |
| Audit creation | Pass. `security_events` has `auth.login` / `accepted` and the metadata JSON does not contain the password. |
| Rate limiting | Pass. The sixth attempt in the window returns `AUTH_THROTTLED`. |
| CSRF | Pass. A cookie mutation without the header is `CSRF_REJECTED`. A foreign `Origin` is 403. |
| Browser authentication flow | Pass. Playwright Chromium completed `e2e/auth-flow.spec.ts`. Details and screenshots are in `docs/SPRINT_2_FINAL_VERIFICATION.md`. |

Sprint 1.1 regression also passed: forced RLS including `invitations`, worker-only outbox listing, suspended tenant hidden by `tenant_is_active`, outbox recovery, and the fail-once processor retry. Test queues used `SALESOS_QUEUE_PREFIX=vitest`, so they did not use the development `foundation` queue.

## Browser path

An earlier cookie-jar check used the Next.js server on `http://127.0.0.1:3010`, which rewrites `/backend` to the API on `127.0.0.1:3011`. Computer Use was not used. The rendered-form run is the Playwright suite recorded in `docs/SPRINT_2_FINAL_VERIFICATION.md`.

The cookie-jar check:

- `POST /backend/api/v1/auth/login` returned 200.
- `Set-Cookie` was `HttpOnly` and `SameSite=Lax`, without `Secure` because this process is not production.
- `GET /backend/api/v1/auth/me` returned display name `Browser Owner` and an organization id.
- Organization, member, and session reads succeeded with that cookie.
- Logout from `Origin: http://evil.example` returned 403.
- Logout from `Origin: http://127.0.0.1:3010` with `X-Salesos-Csrf: 1` returned 204.
- The same cookie then received 401 from `/api/v1/auth/me`.

Port 3000 was already serving a different project, so this check did not use it.
