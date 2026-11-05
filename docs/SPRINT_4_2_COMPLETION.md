# Sprint 4.2 completion

**Date:** 5 November 2026  
**Scope:** Live model validation and final AI runtime acceptance. Sprint 5 was not started. Nothing was committed or pushed. No provider account was created and no credential was purchased.

## Model inventory

A key-name scan of the process environment matched nothing for `LLM`, `OPENAI`, `OLLAMA`, `ANTHROPIC`, `AZURE`, or `MODEL`. The result was `NO_MODEL_ENV_KEYS`.

`model_configurations` in the local database contained 9 rows. Every row has provider `fake`. Zero rows have a non-loopback endpoint. At least one fake row has a ciphertext column populated. That is not a hosted provider, and the fake adapter does not use the network.

Live-provider verification is **NOT TESTED**. The later procedure is `docs/REAL_MODEL_SMOKE_TEST.md`.

## What this sprint verified

The Models form already offers Mock (`fake`), OpenAI-compatible (`openai_compatible`), and Ollama (`ollama`). Hosted and self-hosted OpenAI-compatible endpoints share the provider id. The difference is the endpoint: HTTPS for a remote host, or loopback HTTP only when the row sets `allowPrivateHttp` and the API is not running in production. Playwright selects both HTTP providers, sees the endpoint field and the loopback checkbox, then saves the Mock provider and completes a published-product run.

Model responses return `configured` and `credentialHint`. They do not return `apiKey` or `credentialCiphertext`.

Provider failures were produced by a loopback HTTP stub in `packages/agent-core/src/gateway.spec.ts` and by thrown statuses in `apps/worker/src/recovery.spec.ts`. The stub is not a hosted model. The client preserves 401, 429, 500, 503, and 404. An empty body and a body over 200000 characters become 502. A malformed JSON envelope becomes 400. A 50 ms timeout becomes 504. A destroyed socket becomes 503. The Ollama client against the same 401 stub returns 401. None of these paths construct `FakeLlmProvider`.

The supervisor maps those statuses as follows. `maxRetries` is 1.

| Provider status | First result | After another attempt |
| --- | --- | --- |
| 429, 500, 503, 504 | `FAILED_RETRYABLE` / `PROVIDER` | `FAILED_FINAL` / `PROVIDER` |
| 401, 404, 502 | `FAILED_FINAL` / `PROVIDER` | — |
| 400 | `FAILED_FINAL` / `SCHEMA` | — |

A retryable failure now clears `lease_until` as well as `lease_token`. The next claim moves `FAILED_RETRYABLE` back to `RUNNING` before the model is called again. Without that, the second attempt could not take the lease and the run stayed retryable.

Recovery kills a child process with `SIGKILL` while `research.report.create` is `RUNNING`. The tool row is committed before the model callback, so the kill happens during inference rather than after a local checkpoint. The replacement worker resumes after the dead process's lease is expired, which stands in for the 30 second lease window. A draft goal then reaches `WAITING_APPROVAL` with one action, `sent` count 0, three `llm_usage` rows, and an unchanged report on a second advance. The killed call does not write a usage row. The resumed run writes the three model steps, so the call is at-least-once.

A suspended organization ends `FAILED_FINAL` / `SUSPENDED` before any model call. A paused organization still runs the two internal model tools, then pauses before `sales.message.draft`. The sent count stays 0. Removing `agents.manage` from the initiator ends the queued run `FAILED_FINAL` / `AUTHZ_REVOKED`. Cancelling during the model callback drops the late result.

`decide()` returns `REQUIRE_APPROVAL` / `UNKNOWN_AUDIENCE` for an external action unless `audienceKnown` is explicitly true. Persisted proposals and resume pass `audienceKnown: false`. Known suppression still blocks with `OPT_OUT`. Known human ownership still blocks with `HUMAN_OWNED`. Approval still sets `APPROVED_NOT_EXECUTABLE` and `sent: false`. A second decision on the same approval returns 409.

## Commands

| Command | Exit | Result |
| --- | --- | --- |
| `pnpm lint` | 0 | ESLint completed with no findings. |
| `pnpm typecheck` | 2, then 0 | The first run failed because `child.stdout` and `child.stderr` were possibly null in `recovery.spec.ts`. Optional chaining fixed it. The rerun completed, including Prisma generate and package builds. |
| `pnpm test` | 0 | shared 20, agent-core 6, integrations 1, database 15, API 33, worker 15, web secret scan PASS. |
| `pnpm check:source` | 0 | Source syntax and feature presence checks passed. |
| `NODE_ENV=production pnpm --filter @salesos/web build` | 0 | Next.js 15.5.29 compiled and generated 4 static pages. |
| `PLAYWRIGHT_BROWSERS_PATH=$HOME/Library/Caches/ms-playwright pnpm test:e2e` | 1, then 0 | The first run failed because `getByLabel('Endpoint')` also matched the loopback checkbox. The textbox role fixed it. The rerun passed 5 tests in 47.8s. |

The model used for the complete published-product workflow was the explicit Mock provider (`fake`, display name `Local mock`). Provider failure coverage used the loopback stub and thrown HTTP statuses. No hosted model was selected.
