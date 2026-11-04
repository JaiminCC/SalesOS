# Sprint 3 security review

Review date: 4 November 2026. No new database role was created. `salesos_app`, `salesos_identity`, `salesos_worker`, `salesos_definer`, `salesos_outbox`, and `salesos_directory` keep their Sprint 1.1 and Sprint 2 grants. Earlier migration files were not edited.

## Tenant isolation

Migration `20261104170000_products` enables and forces row-level security on `products`, `product_versions`, `knowledge_documents`, `knowledge_chunks`, `knowledge_embeddings`, `embedding_indexes`, and `organization_product_defaults`. The policy compares `tenant_id` with `app.tenant_id` set inside the transaction by `withTenant`. `packages/database/src/isolation.spec.ts` lists these tables and checks `relrowsecurity` and `relforcerowsecurity`. That spec passed.

The API reads the tenant from the session. Create rejects an extra `organizationId`. Cross-tenant product, document, download, and chunk reads return `404`. The integration test queries `knowledge_chunks` as `salesos_app` without a tenant setting and expects no rows. A worker connection without a tenant sees no products.

## Publication

Publish and the status change that supersedes the previous version share one transaction and one advisory lock. The immutability trigger rejects snapshot updates on published rows. The integration test updates a published snapshot as the app role and expects the database to raise an error matching `draft`. Two concurrent publishes return `200` and `409`, and exactly one row stays `PUBLISHED`.

`products.write` does not imply `products.publish`. The manager fixture can submit and approve and receives `403` on publish. Document approval uses `approvals.manage`. Viewers receive `403` on writes and on draft context preview.

## Files

- Storage keys are server-generated and match `tenant/{uuid}/knowledge/{uuid}`.
- Path traversal, absolute keys, and names with `..` or separators are rejected. The integration test expects `../secret.txt` to return `400`.
- Bytes are outside `apps/web/public`. Responses omit `storageKey`.
- Type, signature, size, zip-bomb, and macro checks run before chunking. HTML script bodies are stripped and not executed.
- SHA-256 duplicates inside the tenant return `409`.
- Download requires `products.read` and the tenant policy. A foreign id returns `404`.
- Document text is not logged. Worker failures stay inside the job.
- There is no user-supplied URL fetch.
- Retention purge lists ids through `list_due_knowledge_deletions`. The function is definer-owned by `salesos_outbox`, returns no content, and can be executed only by `salesos_worker`. `salesos_app` cannot execute it. `salesos_outbox` can select five non-content columns on `knowledge_documents`. That is a privilege expansion of a `BYPASSRLS` `NOLOGIN` role and is limited to those columns.

## Embeddings and CI

Vectors are 384 dimensions. A bad test embedder with 8 dimensions or a different model leaves the document `FAILED` and does not insert a row. The HTTP provider cannot start when `NODE_ENV=test` or `CI=true`. Playwright sets `SALESOS_EMBEDDING_PROVIDER=test` and writes under `.data/e2e-objects`, which teardown removes. CI uses `pgvector/pgvector:pg16` so `CREATE EXTENSION vector` works on an empty database. The queue prefix for Vitest remains `ci`. Playwright remains `playwright`. Mail stays `capture` in tests.

`apps/web` secret scan passed. The web bundle does not import `@salesos/shared`, so Node crypto in the shared package is not shipped to the browser. `localStorage` still drops `permissions`.

## Findings

No open high-severity issue was found in the tests that ran.

Accepted limitations, not silent bypasses:

- PDF text extraction reads literal strings only. A scanned PDF can fail extraction and land in `FAILED`.
- The DOCX reader is a bounded custom parser, not a full Office parser.
- Keyword fallback is explicit. It is not labeled semantic.
- Tombstone document rows remain after the bytes are deleted.
- The prototype footer still describes the shell as a demonstration. Products & Services is labeled live. Other screens stay simulated.
- `salesos_outbox` can see deletion-scheduling columns for every tenant. It cannot see file bytes, hashes, or storage keys through that grant.

## Tests that support this review

`packages/shared/src/knowledge.spec.ts` covers type, signature, HTML stripping, PDF, DOCX, zip traversal, macros, a compression bomb, chunking, embedding length, path traversal, merge precedence, and version transitions.

`apps/api/src/products/products.integration.spec.ts` covers catalog isolation, permission denial, publish authorization, published immutability, upload validation, duplicate hash, download, rejected-document exclusion, keyword and semantic modes, a disabled provider, frozen document ids, draft preview, viewer denial, cross-tenant chunks, incompatible embeddings, and the publish race.

`apps/worker/src/knowledge.spec.ts` covers a missing file and a successful text extraction without throwing.

`packages/database` isolation, definer, and clean-database migration tests passed with the new tables included.
