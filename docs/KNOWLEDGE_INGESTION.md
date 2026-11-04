# Knowledge ingestion

Documents are private tenant files. Metadata is in PostgreSQL. Bytes are in local object storage behind a key that can later point at an S3-compatible store. The API never returns the storage key or a filesystem path.

## Pipeline

```text
UPLOAD -> VALIDATING -> PROCESSING -> EXTRACTED -> INDEXED -> PENDING_APPROVAL -> APPROVED
                                                              \-> REJECTED
PROCESSING | EXTRACTED | INDEXED -> FAILED
APPROVED | REJECTED | FAILED | PENDING_APPROVAL -> reprocess -> PROCESSING
DELETED is terminal for retrieval. Content is removed immediately or after retention.
```

The upload handler records `VALIDATING` and then `PROCESSING` in one transaction with an outbox row `knowledge.document.process.v1`. When `SALESOS_PROCESS_KNOWLEDGE=inline`, the API finishes extraction before the response. The default `queue` mode enqueues `knowledge.process`. If Redis enqueue fails, the outbox row remains for the worker relay. A document that is no longer `PROCESSING` is left alone, so an inline run followed by the worker does not double-write.

`EXTRACTED` and `INDEXED` are stored statuses. A successful job moves to `PENDING_APPROVAL` before it returns, so the UI usually sees `PROCESSING` and then `PENDING_APPROVAL`. `semanticStatus` is `INDEXED` when vectors were written and `UNAVAILABLE` when no embedding provider is configured.

If the worker stops after the extract transaction commits, the document stays `EXTRACTED` and the outbox row stays pending. The next delivery reads the stored chunks, writes any missing embeddings, and continues to `PENDING_APPROVAL`. A document already at `INDEXED` is moved to `PENDING_APPROVAL` without extracting again. Embedding inserts ignore a chunk that already has a vector.

## Accepted files

Extensions: `pdf`, `docx`, `txt`, `md`, `markdown`, `html`, `htm`.

- PDF bytes must start with `%PDF-`. Extraction reads parenthesized literal strings and counts `/Type /Page`. It is not a full PDF parser.
- DOCX must be a zip starting with `PK\x03\x04`. The reader accepts only `word/document.xml`, methods 0 and 8. It rejects encryption, data descriptors, `..`, `vbaProject` and `.bin` macros, more than 30 entries, uncompressed or compressed entries over 4 MB, a compression ratio over 100, and a total over 8 MB.
- Text and Markdown must be UTF-8 without NUL. Markdown sections split on headings.
- HTML drops `script`, `style`, and comments before tags are stripped. Scripts are not executed.

Names containing `..`, a slash, a backslash, or NUL are rejected. The size limit is `SALESOS_KNOWLEDGE_MAX_BYTES` (default 5,242,880, maximum 20,000,000) and is checked before extraction. The JSON parser limit is 12 MB so a normal base64 body can reach that check. Oversized files return `413` `PAYLOAD_TOO_LARGE`. Bad type or signature returns `415` `UNSUPPORTED_MEDIA`.

SHA-256 is calculated on the validated bytes. Unique `(tenant_id, sha256)` returns `409` for an exact duplicate that is not deleted. A tombstone hash `deleted:{id}` frees the slot.

Text is NFKC-normalized, whitespace-collapsed, NUL-stripped, and capped at 1,000,000 characters. Chunks are about 800 characters with 80 characters of overlap, at most 500 chunks. Page or section is kept when the extractor has one. Extracted text is not written to logs. Failure reasons are short fixed messages.

## Storage

Keys match `tenant/{uuid}/knowledge/{uuid}` and are resolved under `SALESOS_STORAGE_ROOT`. A missing root uses `data/objects` from the repo when the process cwd ends in `apps/api` or `apps/worker`. Absolute keys, `..`, and paths that escape the root are rejected. `data/` and `.data/` are gitignored. Playwright uses `.data/e2e-objects` and deletes it in global teardown.

Download is `GET /api/v1/products/:id/knowledge/:documentId/download` for `products.read`. The body is the file, with a sanitized `content-disposition` name. `DELETED` is `404` even if bytes have not been purged yet. Another organization's id is `404`.

## Review, retry, retention

| Action | Permission | Route |
|---|---|---|
| Upload | `products.write` | `POST /api/v1/products/:id/knowledge` body `{ fileName, contentBase64, replacesDocumentId? }` |
| List and detail | `products.read` | `GET .../knowledge`, `GET .../knowledge/:documentId` |
| Approve, reject | `approvals.manage` | `POST .../approve`, `POST .../reject` with `{ reason }` of at least 3 characters |
| Retry a `FAILED` document | `products.write` | `POST .../retry` |
| Reprocess | `products.write` | `POST .../reprocess` |
| Delete | `products.write` | `DELETE .../knowledge/:documentId` returns 204 |

Approve is allowed only from `PENDING_APPROVAL`. Reprocess clears chunks and approval and returns the document to `PROCESSING`. Replacement sets `replacesDocumentId` and must refer to a document of the same product.

`knowledgeRetentionDays` 0 unlinks the file, deletes chunks, sets `sha256` to `deleted:{id}`, `byteSize` 0, and status `DELETED`. A positive value marks `DELETED`, sets `retainUntil`, tombstones the hash, and leaves the bytes until the worker relay calls `purgeDueKnowledge`. Download and retrieval ignore `DELETED` rows.

Audit actions cover upload, approve, reject, replace, reprocess, and delete. They store ids and status, not the document body.

## Worker

`apps/worker/src/knowledge.ts` handles `knowledge.process`. A missing file marks the document `FAILED` and settles the outbox. Any extraction or embedding error is caught, stored, and returned as `FAILED`. The process does not exit. The job log line contains `documentId` and `status` only.

There is no URL import. That avoids turning a user-supplied address into an SSRF fetch.
