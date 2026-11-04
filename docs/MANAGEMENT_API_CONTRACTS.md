# Management API contracts

Base path `/api/v1`. Cookie session `salesos_session`. Cookie-authenticated mutations require `x-salesos-csrf: 1` and, when `Origin` is present, that origin must equal `WEB_ORIGIN`.

Success envelope: `{ data, meta: { requestId } }`. Error envelope: `{ error: { code, message }, meta: { requestId } }`. Validation uses the global whitelist pipe. Unknown fields are rejected.

List bodies and product list queries accept:

| Field | Rule |
| --- | --- |
| `page` | Integer, minimum 1, default 1 |
| `pageSize` | Integer, 1–100, default 20. UI options are 10, 20, 50, and 100 |
| `search` or `q` | String, max 120 characters, matched only against the module's allowlisted columns |
| `sortBy` | One value from that module's allowlist |
| `sortDirection` | `asc` or `desc` |
| filters | Module fields below |

Sort fields are copied from a server object into Prisma `orderBy`. They are never concatenated into SQL. Every sort adds `id` ascending as the tie-break. `page` and `pageSize` are coerced to numbers before `take` and `skip`. Count and page queries inside one tenant transaction run sequentially.

A stale `expectedUpdatedAt` on product update and organization defaults returns `409` with message `This record changed since you opened it. Reload and try again.`

## Navigation

| Method and path | Body | Result |
| --- | --- | --- |
| `POST /navigation/contexts` | `resourceType`, `action` (`view`, `edit`, `add`), optional `resourceId`, `parentId`, `resourceKey`, `organizationContext: "active"` | `201` `{ token, expiresAt }` |
| `POST /navigation/contexts/resolve` | `token` | `200` `{ resourceType, action, resourceId, parentId, resourceKey, expiresAt }` |

A missing, expired, revoked, or cross-tenant token is `404`. The token is not a permission. Resolve checks the resource again.

## Management routes

All of these are `POST /api/v1/management/...`.

| Path | Permission | Success | Notes |
| --- | --- | --- | --- |
| `members/list` | active member | 200 | Default excludes `REMOVED` |
| `members/get` | active member | 200 | Body `{ id }` |
| `members/invite` | `users.invite` | 202 | Creates an invitation. Does not create a password |
| `members/update` | `roles.manage` | 204 | Body `{ userId, role }`. Revokes that user's sessions and navigation contexts |
| `members/remove` | `users.manage` | 204 | Membership only. Last owner is `409` |
| `members/bulk-remove` | `users.manage` | 200 | Per-id results |
| `organizations/create` | signed-in user | 201 | Switches the active organization and revokes navigation contexts |
| `organizations/list` | signed-in user | 200 | Organizations the caller can access |
| `organizations/get` | member of the active organization | 200 | Body id must be the active organization |
| `organizations/update` | `organizations.manage` | 200 | Body id must be the active organization |
| `roles/list` | active member | 200 | Read-only |
| `invitations/list` | `users.invite` or `users.manage` | 200 | No email address in the payload |
| `invitations/revoke` | `users.manage` or `users.invite` | 204 | |
| `invitations/bulk-revoke` | `users.manage` or `users.invite` | 200 | |
| `sessions/list` | the caller | 200 | Own sessions |
| `sessions/revoke` | the caller | 204 | Own session only |
| `sessions/bulk-revoke` | the caller | 200 | Own sessions only |
| `audit/list` | `audit.read` | 200 | Read-only |
| `products/list` | `products.read` | 200 | Same filters as `GET /products` |
| `products/get` | `products.read` | 200 | |
| `products/create` | `products.write` | 201 | Extra `organizationId` is rejected |
| `products/update` | `products.write` | 200 | Optional `expectedUpdatedAt` |
| `products/archive` | `products.write` | 200 | |
| `products/restore` | `products.write` | 200 | |
| `products/duplicate` | `products.write` | 201 | |
| `products/bulk-archive` | `products.write` | 200 | |
| `products/bulk-restore` | `products.write` | 200 | |
| `versions/list` | `products.read` | 200 | Body includes `productId` |
| `versions/get` | `products.read` | 200 | |
| `versions/create` | `products.write` | 201 | Body `{ productId }` |
| `versions/update` | `products.write` | 200 | Draft only. Revision mismatch is `409` |
| `versions/submit` | `products.write` | 200 | |
| `versions/approve` | `approvals.manage` | 200 | |
| `versions/reject` | `approvals.manage` | 200 | |
| `versions/publish` | `products.publish` | 200 | |
| `versions/archive` | `products.write` | 200 | Draft archive |
| `versions/restore` | `products.write` | 201 | Copies an older version into a new draft |
| `icps/list` | `products.read` | 200 | |
| `icps/get` | `products.read` | 200 | |
| `icps/create` | `products.write` | 201 | |
| `icps/update` | `products.write` | 200 | |
| `icps/archive` | `products.write` | 200 | |
| `icps/duplicate` | `products.write` | 201 | |
| `icps/bulk-archive` | `products.write` | 200 | |
| `knowledge/list` | `products.read` | 200 | `DELETED` hidden unless the caller can write and asks for it |
| `knowledge/get` | `products.read` | 200 | |
| `knowledge/upload` | `products.write` | 201 | |
| `knowledge/approve` | `approvals.manage` | 200 | |
| `knowledge/reject` | `approvals.manage` | 200 | |
| `knowledge/retry` | `products.write` | 200 | |
| `knowledge/reprocess` | `products.write` | 200 | |
| `knowledge/delete` | `products.write` | 204 | Retention and tombstone rules still apply |
| `knowledge/bulk-delete` | `products.write` | 200 | |
| `knowledge/bulk-approve` | `approvals.manage` | 200 | Each document is checked |
| `defaults/get` | `products.read` | 200 | |
| `defaults/update` | `products.write` | 200 | Optional `expectedUpdatedAt` |

`GET /api/v1/products/:id/knowledge/:documentId/download` remains the file download. It is authenticated and tenant-scoped. The browser page URL does not include the document id.

## Sort allowlists

| Resource | `sortBy` |
| --- | --- |
| Members | `displayName`, `email`, `role`, `status`, `createdAt` |

## Member email search

`users.email_ciphertext` stays encrypted. `users.email_hmac` is the lookup key for one normalized address. `members/list` does not decrypt the organization in order to filter it.

- No query, and sort is not `email`: the database paginates. Only that page is decrypted. `emailSearch.mode` is `none`.
- A query that is one exact address (`local@domain.tld`) uses the HMAC. That match is included even when the address would fall outside the partial window. Name matches are still complete. `emailSearch.mode` is `exact` and `truncated` is false.
- Any other query matches display names in SQL, then decrypts at most `MEMBER_EMAIL_SEARCH_LIMIT` (100) memberships ordered by `user_id`. Partial email matches outside that window are omitted. `emailSearch.truncated` is true when the organization has more members than the limit. `scanned` is the number of emails decrypted for that request.
- Sorting by `email` with no query uses the same 100-row window.

The response adds `emailSearch: { mode, scanned, limit, truncated }` beside `items`, `page`, `pageSize`, and `total`. An address from another organization does not match. `GET /api/v1/organizations/:id/members` still returns the current member list and decrypts the rows it returns. It is not the search path.
| Organizations | `name`, `status` |
| Audit | `createdAt` |
| Products | `name`, `productType`, `status`, `createdAt`, `updatedAt` |
| ICPs | `name`, `priority` |
| Knowledge | `fileName`, `status`, `createdAt`, `updatedAt` |

A sort value outside the allowlist is `400`. The integration test sends `sortBy=name; drop table products` and expects that rejection.

## Bulk result

```json
{ "results": [{ "id": "...", "ok": true }, { "id": "...", "ok": false, "code": "NOT_FOUND", "message": "..." }] }
```

One to 50 ids. Duplicate ids are `400`. Each id runs in its own tenant transaction. A failure on one id does not roll back a success on another. The response lists both.

## Compatibility

`GET` and `PATCH /api/v1/products/...`, organization invitation and member routes, and auth routes are unchanged. Management routes are an additional way to pass identifiers in the body.
