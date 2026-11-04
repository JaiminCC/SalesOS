# Bulk operation policies

Bulk routes accept 1 to 50 identifiers. Duplicate identifiers are rejected with `400` before any write. The server does not expand a selection to records on other pages. The client sends only the ids checked on the current page.

## Consistency

`runBatch` in `apps/api/src/common/batch.ts` processes ids one at a time. Each call opens its own tenant transaction and its own permission check. The response is `{ results: [{ id, ok, code?, message? }] }`. A failure does not roll back an earlier success. The UI reports the success count and the failure count. Inaccessible or missing ids are `NOT_FOUND` or `FORBIDDEN` for that id. They are not reported as success.

## Allowed bulk operations

| Operation | Who | Rule |
| --- | --- | --- |
| Remove members | `users.manage` | Removes the membership and revokes that member's sessions for the organization. Does not delete the platform user. The last owner returns `CONFLICT` for that id |
| Revoke invitations | `users.invite` or `users.manage` | Sets `revoked_at`. Does not delete the row |
| Revoke sessions | the signed-in user | Only sessions owned by that user. Other users' sessions are not in the list and are not revoked by this route |
| Archive products | `products.write` | Sets `ARCHIVED` |
| Restore products | `products.write` | Sets `ACTIVE` |
| Archive ICPs | `products.write` | Marks the ICP archived on the draft |
| Delete knowledge documents | `products.write` | Same retention, tombstone, and storage rules as a single delete. A document that must be kept is a failure for that id |
| Approve knowledge documents | `approvals.manage` | Each document is authorized on its own. One denial does not approve the rest silently |

## Operations that are not bulk-deleted

| Resource | Policy |
| --- | --- |
| Audit events | Append-only. No update or delete route |
| Organizations | No bulk delete. Suspend or restore the active organization through its status |
| Built-in roles | No custom role CRUD and no delete |
| Published product versions | Immutable. No hard delete. Restore copies an older version into a new draft |
| Active sessions of other users | Not listed and not revoked by the caller's bulk action |
| Records outside the active organization | Row security and the per-id check return not found |

Confirmation dialogs in the browser name the record, or the selected count, and require a second click. The confirm button disables while the request is in flight.
