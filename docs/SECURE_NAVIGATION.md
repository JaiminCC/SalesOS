# Secure navigation

Management pages do not put database primary keys in the path, query string, or fragment. A refresh still opens the record the user selected in that tab.

## Routes

| Purpose | Path |
| --- | --- |
| List | `/workspace/users`, `/workspace/products`, `/workspace/organizations`, `/workspace/sessions`, `/workspace/invitations`, `/workspace/audit`, `/workspace/defaults`, `/workspace/icps`, `/workspace/knowledge` |
| Add | `/workspace/{module}/add` |
| View | `/workspace/{module}/view` |
| Edit | `/workspace/{module}/edit` |

`apps/web/app/workspace/[[...slug]]/page.jsx` renders the same client shell as `/`. The shell reads the path on load and on `popstate`. Sidebar menu ids are unchanged.

## Context lifecycle

1. The user chooses View, Edit, or Add.
2. The browser sends `POST /api/v1/navigation/contexts` with `resourceType`, `action`, the record id when there is one, and `organizationContext: "active"`.
3. The API requires a live session and the active organization. It checks the permission for that action and that the record belongs to the organization and is in a state that allows the action. Product add has no id. Knowledge, ICP, and version add require the parent product id. A published version cannot be opened for edit.
4. The API stores a row in `navigation_contexts` and returns a 32-byte random token once. Only the SHA-256 hash is stored.
5. The browser writes the token to `sessionStorage` under `salesos.navigation`, keyed by `{resourceType}:{action}`. `sessionStorage` is per tab, so two tabs do not replace each other's selection. The token is not written to `localStorage` and not written to the URL.
6. The Edit or View page calls `POST /api/v1/navigation/contexts/resolve`. The API loads the hash for this session and organization, checks expiry, and checks the permission and the record again.
7. A successful resolve slides the expiry forward by 15 minutes, capped at two hours after creation.

Logout, organization switch, creating an organization (because it switches the active organization), role change, owner transfer, member removal, password reset, and revoking a session call `public.revoke_session_navigation(session_id)`. That function is `SECURITY DEFINER`, owned for execution by `salesos_identity`, with `search_path` set to `pg_catalog`. Revoking a session also sets `sessions.revoked_at`. A later resolve on that cookie is `401` because the session guard rejects it before the token is read.

A token stays usable inside the same live session until it expires or is revoked. Resolve is not single-use. Reuse after logout, after `expires_at` has passed, or from a later login is rejected. An expired navigation row is `404` while the session is still live. An expired or revoked session is `401`. A token presented to a different session is `404` because resolve also matches `session_id`, `user_id`, and `tenant_id`. A role change or membership removal revokes that member's sessions, so their open tokens stop resolving.

At most 20 active contexts are kept per session per organization. Creating another revokes the oldest. Expired and revoked rows are deleted when a new context is created.

## What the token is not

The token is not a database id and not an authorization grant. Every list, get, update, archive, and delete checks the session, the permission, and the tenant again. Row security still applies. A guessed token is `404`. A token from another organization is `404` because row security hides it, and a switch revokes it before the next request.

CSRF rules for other cookie mutations apply to both navigation posts. Request logs redact token-like fields.

## Table

`navigation_contexts` has `tenant_id`, `id`, `session_id`, `user_id`, `token_hash` (unique), `resource_type`, `action`, `resource_id`, `parent_id`, `resource_key`, `expires_at`, `revoked_at`, and `created_at`. The primary key is `(tenant_id, id)`. There is no foreign key to `sessions`, so revoking a session does not depend on a cascade. Row security is enabled and forced. `salesos_identity` can read and write the table. `salesos_app` and `salesos_worker` cannot.

Migration: `packages/database/prisma/migrations/20261104190000_navigation_contexts/migration.sql`.

## Multi-tab behavior

Each tab keeps its own token map. The server stores many contexts for one session, looked up by token hash. Opening an editor in a second tab does not revoke the first tab's context unless the 20-context cap is reached. Two tabs share one session cookie, so logging out or revoking that session signs both tabs out. A second browser context has its own cookie. Revoking that other session leaves the current tab signed in. The management browser test opens a second tab, edits one product, reloads, and confirms the first tab still reloads the other product.
