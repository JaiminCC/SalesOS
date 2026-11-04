# Knowledge retrieval

Retrieval is a SQL query under the session tenant. It never scans another organization's chunks. Rejected, failed, deleted, and unapproved documents are excluded. Live agent context also excludes documents that were not frozen into the published snapshot.

## Embedding providers

`SALESOS_EMBEDDING_PROVIDER` is `disabled` (default), `test`, or `http`.

| Provider | Behavior |
|---|---|
| `disabled` | Extraction still runs. `semanticStatus` is `UNAVAILABLE`. Search is keyword. |
| `test` | Deterministic 384-dimension unit vector from SHA-256, model `salesos-test-384`. Used by Vitest and Playwright. |
| `http` | `POST` the configured `SALESOS_EMBEDDING_URL` with `{ input, model }`. Redirects are errors. Timeout is 5 seconds. The URL is the server setting, not a user field. |

`NODE_ENV=test` or `CI=true` refuses `http` at process startup. CI does not call a paid embedding API.

The first successful embedding inserts `embedding_indexes` for that tenant with `ON CONFLICT DO NOTHING`. Later chunks must use the same model and 384 dimensions. A mismatch fails the document and inserts no vector. The column is `vector(384)` with a check constraint. Vectors are written with `INSERT ... ::vector`. Prisma does not send the vector value through `create`.

The model is not switched for an existing index. There is no approximate-nearest-neighbor index. Exact `<=>` is enough for the current volume.

## Search

`POST /api/v1/products/:id/knowledge/search` requires `products.read`.

```json
{ "query": "installation steps", "mode": "semantic", "limit": 5, "documentIds": [] }
```

`mode` is `keyword` or `semantic`. `limit` is clamped to 1..20. `documentIds`, when present, must be a subset of that product's `APPROVED` documents.

The response tells the caller what happened:

```json
{
  "data": {
    "requestedMode": "semantic",
    "mode": "keyword",
    "semanticAvailable": false,
    "embeddingModel": null,
    "results": [
      {
        "chunkId": "…",
        "documentId": "…",
        "fileName": "field-notes.md",
        "page": null,
        "section": "Setup",
        "content": "Approved installation steps for the field kit.",
        "score": null
      }
    ]
  },
  "meta": { "requestId": "req_03" }
}
```

`mode: "keyword"` is a keyword match. It is not semantic similarity. The Products screen says "Keyword match" or "Semantic similarity" from this field.

Keyword matching uses `ILIKE` with `%`, `_`, and `\` escaped, ordered by `chunk_index`, then chunk id. Semantic search orders by cosine distance, then chunk id, so ties are stable. Semantic `score` is `1 - distance`.

If semantic search was requested and the provider or the index is missing or incompatible, the response falls back to keyword and sets `semanticAvailable` to false.

## What live context can see

Human search uses every `APPROVED` document for the product.

`POST /api/v1/products/:id/context/preview` with a published version intersects `snapshot.knowledgeDocumentIds` with documents that are still `APPROVED`. A document approved after publication waits for the next publish. A document rejected after publication drops out even if its id was frozen. Draft preview, available only with `products.write`, uses current approved documents and sets `liveAgentContext` to false.

Every result row is filtered by `tenant_id`, `product_id`, and the allowed document ids inside the SQL statement.
