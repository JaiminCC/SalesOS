# Sprint 2.1 completion

Sprint 2.1 replaces the demonstration permission grid with a read-only matrix from the active organization and adds the Playwright suite to CI. Custom role editing, product configuration, AI agents, campaigns, and new authentication providers were not added. Nothing was committed or pushed. The GitHub Actions workflow was not executed on GitHub.

## Files modified

- `apps/web/components/Enterprise.jsx` — live matrix, loading, empty, and error states
- `apps/web/components/SalesOS.jsx` — role grants are omitted from `localStorage`
- `apps/web/lib/auth-client.ts` — `listRoles` and `listPermissions`
- `apps/web/app/enterprise.css` — the existing table scrolls inside the card
- `apps/web/e2e/auth-flow.spec.ts` — matrix assertions
- `apps/web/e2e/env.ts` — CI can supply database settings without a `.env` file
- `apps/web/e2e/global-teardown.ts` — drops `salesos_e2e` after the suite
- `apps/web/e2e/drop-e2e-database.mjs` — the same drop for the CI cleanup step
- `apps/web/playwright.config.ts` — teardown, failure traces, screenshots, video, and HTML report
- `apps/api/src/identity/identity.service.ts` — permission catalog requires an active organization
- `apps/api/src/identity/organizations.controller.ts`
- `apps/api/src/identity/security.regression.spec.ts`
- `docs/openapi/identity.yaml`
- `.github/workflows/ci.yml`
- `.gitignore`

## Live RBAC UI

Users & Roles labels the directory as live organization data. CRM and AI screens keep the SIMULATED badge and Demonstration data label. The permission card sits on its own row so role names stay on one line. The permission name stays pinned while the role columns scroll horizontally. The card no longer has checkboxes or a custom-role field.

On that screen the browser calls `GET /api/v1/roles` and `GET /api/v1/permissions` for the session’s active organization. Columns are the roles that organization actually has, in server order. Rows are the permission catalog, plus any extra permission string stored on a role. A check mark is shown only when that role’s stored grants include the permission. A dash is shown otherwise. The matrix reloads when the active organization or the member list changes.

Loading copy is “Loading roles and permissions…”. An organization with no roles says “This organization has no roles.” A failed request shows the server message in an alert. A signed-in user with no active organization is told to choose one.

`salesos-prototype-v2` in `localStorage` no longer stores `enterprise.permissions`. The matrix state stays in memory for the current view. Changing that state cannot call an API that grants a permission, because the cells are not controls.

New organizations receive `ADMIN`, `OWNER`, `SALES_AGENT`, `SALES_MANAGER`, and `VIEWER`. Legacy names such as `Manager`, `Owner`, and `Reviewer` appear only when that organization’s role rows contain them. `GET /api/v1/roles` already returned each role with its `role_permissions` rows, so the read contract did not need a new resource. `GET /api/v1/permissions` now returns the catalog only when the session has an active organization.

## Browser evidence

`pnpm test:e2e` on 4 November 2026, after the empty-cell fix, exited 0. Chromium ran `e2e/auth-flow.spec.ts`: 1 passed, test body 9.6s, suite 17.5s. Playwright started the API on `127.0.0.1:3021` and Next.js on `127.0.0.1:3020` with `reuseExistingServer: false`, database `salesos_e2e`, `MAIL_MODE=capture`, and queue prefix `playwright`.

The test confirmed:

- Columns `OWNER` and `VIEWER` are present. Columns `Manager` and `Owner` are absent for a newly registered organization.
- `OWNER has tenant.export` and `VIEWER lacks users.manage`.
- The permission table contains no inputs.
- After creating a second organization, that workspace’s matrix reloads and still has no `Reviewer` column.
- A sales agent cannot invite. After the owner changes that member to `VIEWER`, the member’s existing session is signed out. A new sign-in still shows `VIEWER lacks users.manage` and `OWNER has tenant.export`, and another invite is denied.
- `localStorage` for `salesos-prototype-v2` has no `enterprise.permissions`.

Screenshots from that run:

- `docs/verification/roles.png`
- `docs/verification/users.png`
- `docs/verification/signed-in.png`
- `docs/verification/audit.png`
- `docs/verification/restricted-invite.png`

`docs/verification/roles.png` shows the live directory and the permission matrix. Role names stay on one line. The permission column stays pinned while later roles scroll horizontally when the row is wider than the page.

The first Playwright attempt in this pass failed because a denied cell was an empty span and the browser treated it as hidden. The cell now shows a dash. The retry passed.

## Security review

`security.regression.spec.ts` added “returns only the active organization role grants and blocks them after removal or suspension”. It passed with the rest of the API suite.

- A `Reviewer` role inserted only in organization B is returned to B and is absent from organization A. A new organization also does not include `Manager`.
- `OWNER` includes `tenant.export`. `VIEWER` does not include `users.manage`, `roles.manage`, or `tenant.export`.
- The permission catalog contains `tenant.export` and does not contain an invented name.
- A viewer’s request to assign `OWNER` returns 403. Their `GET /api/v1/roles` response still withholds `users.manage` from `VIEWER`.
- After membership removal, that session’s `GET /api/v1/roles` and `GET /api/v1/permissions` return 401.
- After the active organization is suspended, both reads return 409 and do not include role grants.

The matrix does not submit grants. Server authorization remains the permission guard and the role rows in the database.

## CI changes

`.github/workflows/ci.yml` keeps Postgres 16, Redis 7, `pnpm db:setup`, lint, typecheck, Vitest, `check:source`, the web build, and `scripts/check-audit.mjs`.

Playwright is additional:

- `pnpm --filter @salesos/web exec playwright install --with-deps chromium` uses the `@playwright/test` version in the lockfile.
- `pnpm test:e2e` runs after database setup and the package build.
- `MAIL_MODE=capture` is set on `pnpm test` and `pnpm test:e2e` only.
- Vitest keeps `SALESOS_QUEUE_PREFIX=ci` from the job environment. The Playwright step sets `SALESOS_QUEUE_PREFIX=playwright`. `e2eProcessEnv` also forces that prefix and `salesos_e2e`, so the browser processes do not use the `ci`, development, or production queue.
- Playwright starts its own API and Next.js processes. `reuseExistingServer` stays false. `CI=true` is set on that step.
- Traces, screenshots, and video are retained on failure. The HTML report is written when `CI` is set.
- On failure, `playwright-failure` uploads `docs/verification/playwright-output` and `docs/verification/playwright-report`.
- Playwright global teardown drops `salesos_e2e`. The workflow also runs `node apps/web/e2e/drop-e2e-database.mjs` with `if: always()`.

`ruby -ryaml -e 'YAML.load_file(".github/workflows/ci.yml")'` printed `yaml ok`. `actionlint` is not installed in this environment. This does not mean the remote GitHub Actions run succeeded.

## Commands

| Command | Exit | Result |
| --- | --- | --- |
| `ruby -ryaml -e 'YAML.load_file(".github/workflows/ci.yml")'` | 0 | `yaml ok` |
| `pnpm lint` | 0 | Pass |
| `pnpm typecheck` | 0 | Pass |
| `pnpm test` | 0 | 47 Vitest tests, then the web secret scan |
| `pnpm check:source` | 0 | Pass, including after the matrix dash |
| `pnpm --filter @salesos/web build` | 0 | Next.js 15.5.29 compiled `/` |
| `pnpm test:e2e` | 0 on the retry | 1 Chromium test passed in 17.5s |

Vitest counts: shared 4, agent-core 2, integrations 1, database 15, API 20, worker 5. The API count includes the new role-matrix regression. Database RLS, outbox, and worker retry tests passed. The web secret scan passed.

## Remaining limitations

- There is no custom role editor. Membership role assignment is unchanged.
- The permission matrix scrolls horizontally when the role columns are wider than the page. The permission name stays pinned.
- The remote GitHub Actions workflow has not been run, so browser installation and artifact upload on `ubuntu-latest` are not yet proven.
- Mail capture, missing passwords on seeded owners, no TOTP or SAML, and simulated CRM and AI behavior remain as in Sprint 2.
- Suspending an organization blocks later role reads. There is still no separate unsuspend path for that same session.
- The application is not production-ready.
