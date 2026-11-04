# TypeScript configuration fix

**Date:** 4 November 2026  
**TypeScript:** 5.9.3  
**Node.js:** 22.21.0  
**Next.js:** 15.5.29

## Root cause

`tsconfig.base.json` set `"moduleResolution": "node"`. TypeScript 5.9 treats that value as `node10` and reports TS5107: the option is deprecated and will stop working in TypeScript 7.0. The six workspace configs that extend the base inherit it:

- `apps/api/tsconfig.json`
- `apps/worker/tsconfig.json`
- `packages/database/tsconfig.json`
- `packages/shared/tsconfig.json`
- `packages/agent-core/tsconfig.json`
- `packages/integrations/tsconfig.json`

None of those files set `moduleResolution` themselves. `apps/web/tsconfig.json` does not extend the base and already uses `"moduleResolution": "bundler"`.

The schema warning is separate. No tsconfig in this repository has a `$schema` field. Cursor's TypeScript extension registers `https://www.schemastore.org/tsconfig` for `tsconfig.json`, `tsconfig.*.json`, and `tsconfig-*.json`. That host is the old SchemaStore URL. The same extension also registers its bundled schema at `extensions/typescript-language-features/schemas/tsconfig.schema.json`. Cursor's default for `json.schemaDownload.enable` is `false`, so the remote URL fails and the Problems panel reports that downloads are disabled. JSON validation itself stays on through the bundled schema.

## Previous configuration

```json
"module": "commonjs",
"moduleResolution": "node"
```

`module` and `moduleResolution` were a pair, and emit was CommonJS. `"node"` is the deprecated alias of `node10`.

## Updated configuration

`tsconfig.base.json` now uses the Node pair:

```json
"module": "nodenext",
"moduleResolution": "nodenext"
```

`nodenext` is the right pair for programs that Node runs. `bundler` stays only on `apps/web`, which Next compiles. `ignoreDeprecations` was not added. TypeScript was not downgraded.

No package.json sets `"type": "module"`, so Node and `nodenext` still treat these files as CommonJS. Relative imports such as `./processor` stay extensionless. `tsc` emit checked after the change still starts with `"use strict"` and `require()`. `apps/api/dist/main.js` and `apps/worker/dist/main.js` load under Node that way. Prisma's client is re-exported from `packages/database/dist/index.js` with `require("@prisma/client")`.

`apps/web` is unchanged: `"module": "esnext"` and `"moduleResolution": "bundler"`.

## Schema warning

`.vscode/settings.json` keeps `json.validate.enable` true and does not turn on `json.schemaDownload.enable`. It supplies an inline schema body for the exact URL the extension already requests:

`https://www.schemastore.org/tsconfig`

The JSON language service then has the body locally and does not fetch that URL. The extension's bundled tsconfig schema still matches the same files, so compiler-option validation remains. A reload of the window applies the setting. If a stale TS5107 row remains after this change, run **TypeScript: Restart TS Server** from the command palette.

## Files modified

- `tsconfig.base.json`
- `.vscode/settings.json`
- `docs/TYPESCRIPT_CONFIGURATION_FIX.md`

No migration, auth, tenant, or product code changed.

## Commands

| Command | Exit | Result |
|---|---|---|
| `tsc -p` on api, api build, worker, worker build, database, shared, agent-core, integrations, and web | 0 | No TS5107, TS5110, TS2835, TS2307, or TS1479. |
| `tsc --showConfig` | 0 | The six Node projects and the base resolve to `nodenext` / `nodenext`. Web resolves to `esnext` / `bundler`. None resolve to `node10`. |
| `pnpm lint` | 0 | Clean. |
| `pnpm typecheck` | 0 | Package builds and every workspace typecheck completed. Prisma warned that `package.json#prisma` is deprecated. |
| `pnpm test` | 0 | 32 Vitest tests passed. Web secret scan passed. |
| `pnpm check:source` | 0 | Source markers passed. |
| `pnpm --filter @salesos/web build` | 0 | Next.js 15.5.29 build succeeded. Existing warning: the Next.js ESLint plugin is not configured. |
| `pnpm --filter @salesos/api build` | 0 | `tsc -p tsconfig.build.json`. |
| `pnpm --filter @salesos/worker build` | 0 | `tsc -p tsconfig.build.json`. |

Compiled `node apps/api/dist/main.js` listened on `127.0.0.1:3011` (port 3011 so it would not collide with a dev server). `GET /api/v1/health/ready` returned 200. Compiled `node apps/worker/dist/main.js` logged `worker started`. `POST /api/v1/jobs/foundation-ping` returned 202, and the job reached `SUCCEEDED` with attempts 1 and outbox `PROCESSED`. The logs did not contain a module-resolution error. `require('@salesos/database')` from the built package exported `PrismaClient`.

## Remaining warnings

- Prisma 6 still warns that `package.json#prisma` is deprecated. That is unrelated to module resolution.
- `next build` still warns that the Next.js ESLint plugin is not in the ESLint config.
- Cursor will keep showing the schema problem until the window reloads and picks up `.vscode/settings.json`. The compiler no longer reports TS5107.
