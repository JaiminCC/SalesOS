# Product versioning

A product version is a snapshot of ICPs, positioning, pricing, and the knowledge document ids frozen at publication. Draft edits change that snapshot. Published rows do not.

## States

```text
DRAFT -> IN_REVIEW -> APPROVED -> PUBLISHED -> SUPERSEDED
              |            |
              v            v
          REJECTED     (publish only)
DRAFT -> ARCHIVED
```

`canTransitionVersion` allows only those edges. `REJECTED`, `SUPERSEDED`, and `ARCHIVED` have no outgoing transition. Restoring an older version creates a new `DRAFT`. It does not reopen the old row.

| Transition | Permission | Route |
|---|---|---|
| Open draft, edit, submit, archive a draft | `products.write` | `POST /versions`, `PATCH /versions/:versionId`, `POST .../submit`, `POST .../archive` |
| Approve or reject | `approvals.manage` | `POST .../approve`, `POST .../reject` |
| Publish | `products.publish` | `POST .../publish` |
| New draft from a published or superseded version | `products.write` | `POST .../restore` |
| Read and compare | `products.read` | `GET /versions`, `GET /versions/:versionId`, `GET .../compare?against=` |

`SALES_MANAGER` can edit and approve. That role does not have `products.publish`. `ADMIN` and `OWNER` can publish. The service checks the transition permission again inside the transaction.

A product may have one open `DRAFT`. A second `POST /versions` returns `409` `CONFLICT`.

## Concurrency and immutability

Draft `PATCH` sends the `revision` last read. The update matches that revision and increments it. A stale revision returns `409`.

Publishing runs inside `withTenant` and takes `pg_advisory_xact_lock(hashtext(tenant), hashtext(product))`. The current `PUBLISHED` row becomes `SUPERSEDED`. The `APPROVED` row becomes `PUBLISHED`, `publishedAt` is set, and `snapshot.knowledgeDocumentIds` is replaced with the ids of documents that are `APPROVED` at that moment. The trigger allows that one JSON key to change on this transition and rejects every other snapshot write. A second concurrent publish sees the row is no longer `APPROVED` and returns `409`. The transaction rolls back together, so a failed publish does not leave a superseded version without a replacement.

`SUPERSEDED` and `PUBLISHED` snapshots are readable by anyone with `products.read`. Draft, in-review, approved, and rejected snapshots are returned only to callers with `products.write`.

Compare returns the changed top-level keys: `icps`, `positioning`, `pricing`, `knowledgeDocumentIds`.

## Audit

Each transition writes an `audit_events` row in the same transaction. The action is `product_version.` plus the destination status in lower case: `product_version.in_review`, `product_version.approved`, `product_version.rejected`, `product_version.published`, and `product_version.archived`. Opening a draft writes `product_version.create`. A draft save writes `product_version.update`. Restore writes `product_version.restore` on the new draft. The payload includes the request id, the previous status, and any rejection reason. It does not include document text.

## Example

Submit, approve, and publish use HTTP 200. Create and restore use HTTP 201.

```http
PATCH /api/v1/products/{productId}/versions/{versionId}
```

```json
{
  "revision": 1,
  "positioning": { "valuePropositions": ["Works away from the office"] }
}
```

The server merges that object onto the current snapshot and validates the whole snapshot. A published `PATCH` returns `409`.

```http
GET /api/v1/products/{productId}/versions/{versionId}/compare?against={otherVersionId}
```

```json
{
  "data": {
    "left": { "id": "…", "versionNumber": 2, "status": "PUBLISHED" },
    "right": { "id": "…", "versionNumber": 1, "status": "SUPERSEDED" },
    "changed": ["positioning", "knowledgeDocumentIds"]
  },
  "meta": { "requestId": "req_02" }
}
```
