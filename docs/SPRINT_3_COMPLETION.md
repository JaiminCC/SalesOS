# Sprint 3 completion

Sprint 3 adds organization-scoped products, immutable published versions, structured ICPs, sales positioning and pricing, private document ingestion, pgvector retrieval, and an agent-context preview. Authentication, sessions, RBAC, and the existing worker ping path are unchanged. Live outreach, WhatsApp sending, autonomous agents, billing, and new SSO providers were not added. Nothing was committed or pushed. GitHub Actions was not executed on GitHub.

## Files created

- `packages/database/prisma/migrations/20261104170000_products/migration.sql`
- `packages/shared/src/product.ts`
- `packages/shared/src/knowledge.ts`
- `packages/shared/src/knowledge.spec.ts`
- `packages/shared/src/object-storage.ts`
- `packages/database/src/knowledge-ingest.ts`
- `apps/api/src/products/products.controller.ts`
- `apps/api/src/products/products.service.ts`
- `apps/api/src/products/products.dto.ts`
- `apps/api/src/products/products.integration.spec.ts`
- `apps/worker/src/knowledge.ts`
- `apps/worker/src/knowledge.spec.ts`
- `apps/web/components/Products.jsx`
- `apps/web/app/products.css`
- `apps/web/e2e/products.spec.ts`
- `docs/PRODUCT_CONFIGURATION.md`
- `docs/PRODUCT_VERSIONING.md`
- `docs/ICP_CONFIGURATION.md`
- `docs/KNOWLEDGE_INGESTION.md`
- `docs/KNOWLEDGE_RETRIEVAL.md`
- `docs/AGENT_CONTEXT_CONTRACT.md`
- `docs/SPRINT_3_SECURITY_REVIEW.md`
- `docs/SPRINT_3_COMPLETION.md`

## Files modified

- `packages/database/prisma/schema.prisma`
- `packages/database/src/index.ts`
- `packages/database/src/tenant-tables.ts`
- `packages/shared/src/index.ts`
- `packages/shared/src/jobs.ts`
- `packages/shared/package.json`
- `packages/shared/tsconfig.json`
- `pnpm-lock.yaml`
- `apps/api/src/app.module.ts`
- `apps/api/src/config/env.ts`
- `apps/api/src/main.ts`
- `apps/api/src/jobs/queue.provider.ts`
- `apps/worker/src/env.ts`
- `apps/worker/src/main.ts`
- `apps/worker/src/processor.ts`
- `apps/web/components/SalesOS.jsx`
- `apps/web/lib/auth-client.ts`
- `apps/web/e2e/env.ts`
- `apps/web/e2e/global-teardown.ts`
- `docs/check_source.cjs`
- `docs/ARCHITECTURE.md`
- `docs/DATABASE_DESIGN.md`
- `docs/IMPLEMENTATION_PLAN.md`
- `.gitignore`
- `infra/docker-compose.yml`
- `infra/docker-compose.prod.yml`
- `.github/workflows/ci.yml`

The existing auth Playwright test rewrote `docs/verification/*.png` during the browser run. Those screenshots were restored so this sprint does not replace Sprint 2.1 evidence.

## Database

Migration `20261104170000_products` creates the `vector` extension and the seven tenant tables in `docs/DATABASE_DESIGN.md` §3.2. It was applied locally with `pnpm db:migrate` against the existing `salesos` database. The volume `infra_salesos_postgres` was not deleted. The running Postgres container was recreated earlier in this sprint as `pgvector/pgvector:pg16` without removing that volume. CI and the production compose file use the same image pin.

## API

All routes are under `/api/v1`, behind the session guard, and use the active organization from the session.

- `GET` and `PUT /product-defaults`
- `GET` and `POST /products`
- `GET` and `PATCH /products/:id`
- `POST /products/:id/duplicate`, `/archive`, `/restore`
- `GET /products/:id/activity`
- `GET` and `POST /products/:id/versions`
- `GET` and `PATCH /products/:id/versions/:versionId`
- `GET /products/:id/versions/:versionId/compare?against=`
- `POST .../submit`, `/approve`, `/reject`, `/publish`, `/archive`, `/restore`
- `GET` and `POST /products/:id/icps`
- `PATCH /products/:id/icps/:icpId`
- `POST .../duplicate` and `.../archive`
- `GET` and `POST /products/:id/knowledge`
- `POST /products/:id/knowledge/search`
- `GET /products/:id/knowledge/:documentId`
- `GET /products/:id/knowledge/:documentId/download`
- `POST .../approve`, `/reject`, `/retry`, `/reprocess`
- `DELETE /products/:id/knowledge/:documentId`
- `POST /products/:id/context/preview`

State changes and search return HTTP 200. Creates return HTTP 201. Delete returns 204. There is no Nest Swagger module. The contracts above are the documentation.

## Frontend

Products & Services mounts `Products` inside the existing shell. The screen covers the catalog, create, details, versions, draft positioning, ICPs, pricing, objections, knowledge upload and review, search, and published context preview. It uses the session client, the organization selector, and the existing type and color. Actions follow `products.write`, `products.publish`, and `approvals.manage`. Dirty drafts warn on navigation and `beforeunload`. The page shows LIVE DATA. Command Center and the other unfinished screens stay SIMULATED. The simulated header action that only stored an offering locally was removed.

## Worker

`knowledge.process` consumes `knowledge.document.process.v1` on the foundation queue. The relay also purges knowledge whose retention date has passed. Document errors are stored on the row and do not crash the worker. `foundation.ping` is unchanged.

## Tests executed

Final local run on 4 November 2026, after the worker resume fix:

| Command | Result |
|---|---|
| `pnpm lint` | Exit 0 |
| `pnpm typecheck` | Exit 0 |
| `pnpm test` | Exit 0. Shared 12, agent-core 2, integrations 1, database 15, API 24, worker 7. Web secret scan `PASS web source does not reference server secrets`. |
| `pnpm check:source` | Exit 0 |
| `pnpm --filter @salesos/web build` | Exit 0. Next.js 15.5.29 compiled the production build. |
| `pnpm test:e2e` | Exit 0. 2 passed in 19.9s. Auth flow 9.2s. Product flow 3.9s. Database `salesos_e2e`, queue prefix `playwright`, ports 3020 and 3021, `reuseExistingServer: false`. |

A separate live run started the API on `127.0.0.1:3091` and the BullMQ worker with queue prefix `sprint3live` against a fresh database, `salesos_sprint3_verify`. That database was migrated, checked for the `vector` extension and `knowledge_embeddings.embedding`, and dropped at the end. The worker log showed `knowledge processed` with status `PENDING_APPROVAL`. The outbox row moved from `PENDING` to `PROCESSED`, and the completed Redis job was `knowledge.process`. Approval then returned the chunk from published context.

The same run killed the worker with `SIGKILL` while a document was `EXTRACTED` and the embedding request was still open. The restarted worker resumed that document to `PENDING_APPROVAL` with `semanticStatus` `INDEXED`.

Context checks in that run passed: the live preview stayed on the latest published version; a draft preview had `liveAgentContext` false; unapproved, rejected, deleted, and other-organization text were absent; the superseded version still returned its own positioning.

The product browser test created a product, saved positioning, added an ICP, uploaded Markdown, approved the document, submitted and approved the version, published it, and read the live context citation. It then created a second organization, confirmed the product was absent, switched back, and confirmed the product was visible. Command Center still showed SIMULATED.

`pnpm check:source` in the table above was re-run after `docs/check_source.cjs` gained the company-name walk. That re-run is recorded in the sprint notes as exit 0.

GitHub Actions was not run from this session. The workflow file now uses `pgvector/pgvector:pg16`. That remote result is unknown.

## Known limitations

- PDF and DOCX extraction are bounded and conservative. Scanned PDFs fail closed.
- No URL import and no S3 adapter class. Storage is a private local directory addressed by a tenant key.
- No ANN index.
- Semantic indexing is unavailable until a provider is configured. Keyword results stay labeled keyword.
- One embedding model and 384 dimensions per tenant.
- Retention purge depends on the worker relay.
- Deleted documents leave a tombstone row.
- Playwright processes documents inline. It does not start `apps/worker`.
- The shell footer still says the prototype includes fictional simulations.
- Lead scoring weights and outbound drafts are not part of this sprint.

## Sprint 4 prerequisites

- Call this context service from the supervisor with `provenance.versionId` stored on the run.
- Keep policy in front of any external action. Positioning text is not a policy.
- Configure an embedding provider outside CI if semantic search is required in a deployment. Leave CI on `disabled` or `test`.
- Add an object-storage adapter only when a deployment leaves the local disk. Keep the key format.
- Add an ANN index only after a measured retrieval workload needs it.
- Campaigns, mailbox send, WhatsApp, and CRM remain later phases and stay simulated until those phases land.
