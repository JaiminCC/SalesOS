# Authentication architecture

Sprint 2 replaces the simulated browser sign-in with a server session. AI sales features on the existing screens stay simulated and keep the SIMULATED badge.

## Roles that touch identity data

Ordinary tenant queries still use `salesos_app` through `DatabaseService`. That login cannot read `users`, `sessions`, `tenants`, password hashes, or tokens.

Authentication and organization bootstrap use a second Prisma client, `IdentityDatabase`, connected as `salesos_identity`. That login is `NOSUPERUSER` and `NOBYPASSRLS`. It can maintain platform identity tables and, inside `withTenant`, the tenant tables it was granted.

`salesos_directory` is `NOLOGIN` and `BYPASSRLS`. It owns two functions and nothing else:

- `list_user_memberships(uuid)` returns one user's organizations, membership status, and role names.
- `lookup_invitation(text)` returns one invitation by its token hash.

Both set `search_path` to `pg_catalog`, quote schema-qualified tables, and are executable only by `salesos_identity`. `salesos_app` and `salesos_worker` are revoked. The outbox function `list_pending_outbox` is unchanged and remains worker-only.

`pnpm db:role` creates `salesos_identity` from `SALESOS_IDENTITY_PASSWORD` before `pnpm db:migrate`. The migration refuses to continue if that login is missing.

## Passwords and tokens

Passwords are hashed with the `argon2` package, type `argon2id`, memory cost 19456, time cost 2, and parallelism 1. The minimum length is 12. Unknown emails are checked against a dummy hash so the response stays `INVALID_CREDENTIALS`.

Session, reset, verification, and invitation tokens are 32 random bytes, base64url. Only the SHA-256 hex digest is stored. Captured mail, used by local tests, stores the raw token in `captured_messages`, which `salesos_app` cannot read. `MAIL_MODE=capture` is refused when `NODE_ENV=production`.

Registration of an existing email returns the same 202 as a new email. Forgot-password does the same. Login failures for an unknown user, a wrong password, and an unverified user share one error code.

`auth_attempts` counts failures for 15 minutes. Five failures for an email HMAC, or 20 for an IP HMAC, return `AUTH_THROTTLED`.

## Tenant context

The client never supplies the tenant used for authorization. Login chooses the first active membership in an active organization and stores it on `sessions.active_tenant_id`. `POST /api/v1/organizations/:id/switch` replaces that column only after `list_user_memberships` shows an active membership in an active organization.

Member, role, invitation, and audit changes then call `withTenant` on the identity client. `set_config('app.tenant_id', ..., true)` is transaction-scoped, so a pooled connection does not keep the tenant after commit. Missing context still returns no rows under `FORCE ROW LEVEL SECURITY`.

## What this sprint does not do

TOTP, recovery codes, SAML, and OIDC are not connected. The MFA and Single Sign-On screens remain visible and do not create a session. No live email provider is configured. Seeded Northstar and Sample Agency users have no password hash, so they cannot sign in until a password is set through the reset flow.
