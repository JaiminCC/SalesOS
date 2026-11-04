# Dependency audit report

**Date:** 4 November 2026  
**Command:** `pnpm audit --json`  
**Lockfile:** `pnpm-lock.yaml` after `pnpm install` with overrides `multer@2.5.0` and `postcss@8.5.32`  
**Checker:** `node scripts/check-audit.mjs`  
**Owner:** Jaimin Belani

`pnpm audit` exits 1 while any advisory remains. That exit code is expected. `node scripts/check-audit.mjs` exits 0 only when every advisory id is in `docs/security/dependency-exceptions.json` and each exception has an owner, a reason, and a `reviewBy` date that is still in the future. An exception is not a resolved vulnerability.

Audit after the PostCSS override:

| Severity | Count in `pnpm audit` metadata |
|---|---|
| Critical | 2 |
| High | 1 |
| Moderate | 5 |
| Low | 0 |
| Info | 0 |

Unique GitHub advisory ids: 6. The metadata count is higher because one advisory is reported on both `vitest` and `@vitest/mocker`, and minimatch is installed at two versions.

`node scripts/check-audit.mjs` printed `Audit advisories are covered by the exception list (6).` and exited 0.

Direct Zod remains 4.6.7. The multer override remains 2.5.0. Neither appeared in this audit.

## Remediated in this sprint

These were present in the Sprint 1 audit as nested `postcss@8.4.31` via `apps/web > next@15.5.29 > postcss@8.4.31`. Direct `postcss` was already 8.5.32. Next 15.5.29 is the newest 15.5 release and still depends on 8.4.31, so the lockfile override pins every `postcss` copy to 8.5.32. They are no longer in the audit output and they were removed from the exception register.

| Advisory | Severity | Package | Vulnerable range | Patched | When it ran | Exposure | Remediation |
|---|---|---|---|---|---|---|---|
| GHSA-qx2v-qp2m-jg93 | moderate | postcss | `<8.5.10` | `>=8.5.10` | Next.js CSS build | Unescaped `</style>` in CSS stringify. Build-time, web package only. | Override `postcss@8.5.32` |
| GHSA-6g55-p6wh-862q | high | postcss | `<=8.5.11` | `>=8.5.12` | Next.js CSS build | `sourceMappingURL` file read during CSS processing. | Override `postcss@8.5.32` |
| GHSA-fxqj-rqcc-2cmp | moderate | postcss | `<=8.5.22` | `>=8.5.23` | Next.js CSS build | Incomplete fix of the source-map read when `from` is unset. | Override `postcss@8.5.32` |
| GHSA-r28c-9q8g-f849 | high | postcss | `<=8.5.17` | `>=8.5.18` | Next.js CSS build | Path traversal while auto-loading a previous source map. | Override `postcss@8.5.32` |

Compatibility: 8.5.32 is the version `apps/web` already declared. No other major of PostCSS was present in the lockfile. `pnpm --filter @salesos/web build` completed after the override.

## Open exceptions

Review date 4 November 2026. Remediation deadline 4 December 2026. Owner Jaimin Belani. Details and the reason each major upgrade was rejected are in `docs/security/DEPENDENCY_REMEDIATION_PLAN.md`.

| Advisory | Severity | Installed | Chain | Runtime | Patched line |
|---|---|---|---|---|---|
| GHSA-5gmw-xhrv-c9v3 | critical | tinypool 1.1.1 | `vitest@3.2.7 > tinypool@1.1.1` in api, worker, database, shared, agent-core, integrations, web | Development tests only | tinypool `>=2.1.1` |
| GHSA-85c8-ppgw-ccpr | critical | tinypool 1.1.1 | same Vitest 3 chain | Development tests only | tinypool `>=2.1.2` |
| GHSA-82fw-gwwq-j7x9 | moderate | vitest 3.2.7 and `@vitest/mocker` 3.2.7 | direct `vitest` devDependency, then `@vitest/mocker` | Development tests only | Vitest and mocker `>=4.1.11` |
| GHSA-qxg6-89mg-rqv8 | moderate | `@vitest/mocker` 3.2.7 | `vitest@3.2.7 > @vitest/mocker@3.2.7` | Development tests only | `@vitest/mocker >=4.1.12` |
| GHSA-ggr8-5vv4-36mx | high | deepmerge-ts 7.1.5 | `@prisma/client@6.19.3 > prisma@6.19.3 > @prisma/config@6.19.3 > deepmerge-ts@7.1.5` | Prisma CLI and client install, not request handling | deepmerge-ts `>=8.0.0` |
| GHSA-g3hv-75wg-m249 | moderate | minimatch 3.1.5 and 10.2.6 | `eslint@9.39.5` (3.1.5) and `typescript-eslint@8.72.1` (10.2.6) | Development lint | minimatch `>=11.0.1` |

`pnpm install` also warned that `eslint@9.39.5` is deprecated and that `cron-parser@4.9.0` is a deprecated subdependency. Those warnings are not GitHub advisories and were not patched in this sprint.

## SalesOS exposure of the open items

Tinypool and Vitest are not imported by `apps/api` or `apps/worker` production code. The critical tinypool issues are prototype-pollution gadgets in worker options. Nothing in SalesOS passes request input into `tinypool`. The risk is a developer or CI process running Vitest, not the deployed API.

`deepmerge-ts` is reached when Prisma loads configuration. SalesOS does not pass user JSON through `@prisma/config`. A stack overflow would require a cyclic object handed to that merge. That is a CLI concern for whoever runs Prisma, not a tenant request path.

`minimatch` runs when ESLint expands glob patterns from this repository's config. It is not on the API request path. The advisory is a denial-of-service against the linter when a glob is amplified.

None of these six packages are bundled into the Next.js client by the application source. They remain installed in the workspace, so they stay on the exception register until a compatible upgrade removes them from `pnpm audit`.
