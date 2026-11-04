# Management test results

Executed locally on 4 November 2026 after the Sprint 3.1 fixes. Remote GitHub Actions was not run.

Commands, in order:

```text
pnpm lint
pnpm typecheck
pnpm test
pnpm check:source
NODE_ENV=production pnpm --filter @salesos/web build
pnpm test:e2e
```

`NODE_ENV` was set to `production` for the web build because the shell had `NODE_ENV=development` from `.env`. Next.js rejects a non-production `NODE_ENV` during `next build`.

## Results

| Command | Result |
| --- | --- |
| `pnpm lint` | Pass. `eslint .` exited 0 |
| `pnpm typecheck` | Pass. Shared, web, agent-core, integrations, database, worker, and API |
| `pnpm test` | Pass. 68 tests |
| `pnpm check:source` | Pass |
| `pnpm --filter @salesos/web build` | Pass. Routes `/`, `/_not-found`, and `/workspace/[[...slug]]` |
| `pnpm test:e2e` | Pass. 4 Chromium tests, 39.5 seconds |

### `pnpm test` counts

| Package | Files | Tests |
| --- | --- | --- |
| `@salesos/shared` | 2 | 12 |
| `@salesos/agent-core` | 2 | 2 |
| `@salesos/integrations` | 1 | 1 |
| `@salesos/database` | 5 | 15 |
| `@salesos/api` | 8 | 31 |
| `@salesos/worker` | 3 | 7 |
| `@salesos/web` | secret scan | Pass |

Database: migration probe, definer privileges (4), tenant isolation (5), connectivity (1), crypto (4). Isolation includes `navigation_contexts` with forced row security.

API: security regression (5), auth integration (7), management integration (7), products integration (4), jobs (1), health (2), env (4), logger (1).

Worker: processor (2), recovery (3), knowledge (2).

### Management integration

`apps/api/src/management/management.integration.spec.ts` covers:

- A sort value of `name; drop table products` is `400`.
- Product search and name sort return the expected order.
- A product id from another organization is `404`.
- Duplicate bulk ids are `400`.
- Bulk archive of one real id and one unknown id returns one success and one `NOT_FOUND`.
- A stale `expectedUpdatedAt` is `409`.
- Two navigation tokens stay independent. A guessed token is `404`.
- An edit context for a published version is `409`.
- Creating or switching an organization revokes the previous token.
- Bulk removal of the last owner is `CONFLICT`.
- Audit list returns `product.create`. `POST /api/v1/management/audit/update` is `404`.
- Login returns the last authorized organization, and a suspended organization is skipped.
- Exact email search finds an address outside the 100-row decrypt window. A partial email in that window is omitted and `emailSearch.truncated` is true. An address from another organization is not returned. A list with no query reports `emailSearch.mode` `none`.
- An expired navigation token is `404`. An expired session, logout, and a role change are `401`. The same token on a later login is `404`.

### Browser

| Spec | Result |
| --- | --- |
| `e2e/auth-flow.spec.ts` | Pass. Register, verify, members, role matrix, audit heading, second organization, invitation, guest permission denial, role change |
| `e2e/products.spec.ts` | Pass. Create, ICP, positioning, knowledge approval, version publish, preview, second organization isolation |
| `e2e/management.spec.ts` | Pass. Add User, member search and role filter, add product, edit refresh, no UUID in the URL, second tab edit, ICP page, knowledge upload, document filter and sort, confirmed delete with a `DELETED` tombstone, archive confirmation, bulk archive, empty organization, bulk member removal with `REMOVED` memberships, and revocation of a second session |

Playwright uses database `salesos_e2e`, ports 3020 and 3021, queue prefix `playwright`, and inline knowledge processing. It does not send external email or outreach.

## Coverage notes

The management browser spec confirms bulk member removal, session revocation, and knowledge deletion, then reads the persisted membership, session, and document rows. Product page-size changes are still covered by the API list contract rather than the browser.
