# Sprint 4 final acceptance

**Date:** 5 November 2026  
**Verdict:** CONDITIONAL PASS  
**Sprint 5:** Not started. Local Ollama inference passed. Suppression, ownership, and quiet hours are still not loaded from lead data.

The production path is the checkpointed supervisor. It reads the selected `model_configurations` row, pins a published product version, and calls `createModelClient`. `FakeLlmProvider` runs only when that row says `fake`. External actions stay unsent.

## Matrix

| Check | Result | Evidence |
| --- | --- | --- |
| OpenAI-compatible hosted provider can be configured | PASS | Models form option `openai_compatible`, HTTPS endpoint, password credential. Playwright shows the endpoint field. |
| Self-hosted OpenAI-compatible provider can be configured | PASS | Same provider id. Loopback HTTP requires `allowPrivateHttp` and a non-production process. Playwright shows the loopback checkbox. |
| Ollama can be configured | PASS | Provider option `ollama`. Playwright selects it and shows the endpoint field. The Ollama client returns 401 from the loopback stub. |
| Deterministic test provider can be configured | PASS | Provider `fake`. Playwright saves `Local mock` and completes a published-product run. |
| Credentials stay encrypted and off the browser | PASS | Create and update encrypt `apiKey`. `publicModel` returns `configured` and `credentialHint` only. Web secret scan PASS. |
| Real inference | PASS | Local Ollama. Model `gemma4:e4b`. Provider `ollama`. Evidence in `docs/REAL_MODEL_SMOKE_TEST.md`. |
| Published product context | PASS | The run pinned a published version. Rejected knowledge stayed out of the snapshot. |
| Eight tool executions | PASS | The same run completed all eight planned tools. |
| Citation provenance | PASS | The report cited the approved source. The rejected source was absent. |
| Approval without external delivery | PASS | `APPROVED_NOT_EXECUTABLE` and `sent: false`. |
| Supervisor recovery tests | PASS | `apps/worker/src/recovery.spec.ts`, including lease renewal and the 10 minute deadline. |
| Hosted cloud provider | NOT TESTED | No hosted credential was configured or purchased. |
| HTTP 401 | PASS | Stub status 401. Run `FAILED_FINAL` / `PROVIDER` on the first attempt. |
| HTTP 429 | PASS | Stub status 429. First attempt `FAILED_RETRYABLE` / `PROVIDER`. Second attempt `FAILED_FINAL` / `PROVIDER`. |
| HTTP 500 | PASS | Same retry then terminal mapping as 429. |
| HTTP 503 | PASS | Stub status 503, including a destroyed socket. Same retry mapping as 429. |
| Connection timeout | PASS | 50 ms abort becomes client status 504, then `FAILED_RETRYABLE` / `PROVIDER`. |
| Malformed structured output | PASS | Malformed envelope becomes client status 400, then `FAILED_FINAL` / `SCHEMA`. |
| Empty model response | PASS | Client status 502, then `FAILED_FINAL` / `PROVIDER`. |
| Oversized provider response | PASS | Body over 200000 characters becomes 502, then `FAILED_FINAL` / `PROVIDER`. |
| Invalid model identifier | PASS | Stub HTTP 404 becomes `FAILED_FINAL` / `PROVIDER`. |
| Connection interruption | PASS | Socket destroy becomes client status 503 and is retryable. |
| Worker killed during model inference | PASS | Child `SIGKILL` while `research.report.create` is `RUNNING`. |
| Worker restarted and resumed from the checkpoint | PASS | After the dead lease is expired, the same run reaches `WAITING_APPROVAL`. |
| No duplicate final action or report | PASS | One action. A second advance leaves the report JSON unchanged. |
| No continuation after cancellation | PASS | Cancel during the callback leaves `CANCELLED` and drops the late result. |
| No continuation after tenant suspension | PASS | `FAILED_FINAL` / `SUSPENDED` and zero model calls. |
| No continuation after permission revocation | PASS | `FAILED_FINAL` / `AUTHZ_REVOKED` after `agents.manage` is removed. |
| Accurate usage and failure records | PASS | Killed call writes no usage. Resume writes three usage rows. Retry and terminal codes match the table in `docs/SPRINT_4_2_COMPLETION.md`. |
| External communication disabled | PASS | Sent count 0 in recovery, integration, and Playwright. Approval sets `APPROVED_NOT_EXECUTABLE`. |
| Unknown suppression cannot authorize an external action | PASS | `audienceKnown !== true` returns `REQUIRE_APPROVAL` / `UNKNOWN_AUDIENCE`. It does not return ALLOW. There is still no lead table. |
| Unknown human ownership cannot authorize an external action | PASS | The same `audienceKnown` gate covers an audience whose ownership was not established. Known `humanOwned: true` still blocks with `HUMAN_OWNED`. |
| Paused organization cannot execute a restricted action | PASS | Internal research runs. The run pauses before `sales.message.draft`. Sent count 0. |
| Approval does not imply sending | PASS | Decision `APPROVED` stores `sent: false` and `executable: false`. |
| Approval replay denied | PASS | Wrong digest and a second decision both return 409 in `agents.integration.spec.ts`. |
| `pnpm lint` | PASS | Exit 0 on the Sprint 4 close. |
| `pnpm typecheck` | PASS | Exit 0 on the Sprint 4 close. |
| `pnpm test` | PASS | Exit 0. shared 20, agent-core 6, integrations 1, database 15, API 33, worker 17, web secret scan PASS. |
| `pnpm check:source` | PASS | Exit 0. |
| Production web build | PASS | `NODE_ENV=production pnpm --filter @salesos/web build` exited 0. |
| `pnpm test:e2e` | PASS | Exit 0, 5 passed, 50.9s. Browser path was `$HOME/Library/Caches/ms-playwright`. |

## Real versus mock

| Exercise | Provider actually called |
| --- | --- |
| Playwright agent run and approval | `fake` / `Local mock` |
| API agent integration | `fake` |
| Gateway failure spec | Loopback `openai_compatible` and `ollama` stub. Fixture key `stub-secret`. No fallback to fake. |
| Recovery provider-status spec | No network. The completion callback throws the HTTP status. |
| Recovery kill during inference | `fake` completion after restart. The killed callback never returned. |
| Local Ollama supervisor run | `ollama` / `gemma4:e4b`. Usage source `provider`. Sent remained false. |

## Security

No new Critical or High defect was opened. Credentials are encrypted at rest and are not in the model JSON. SSRF checks still reject metadata addresses, public HTTP, private ranges, and redirects. External proposals require approval when the audience is unknown, and approval cannot send. A paused organization and a suspended organization stop restricted work. A revoked `agents.manage` permission stops a queued run.

## Recovery

The model call sits outside the claim transaction. The tool row and lease are durable before inference. The lease lasts 30 seconds and is renewed every 10 seconds while the request runs, so a call of up to 3 minutes keeps the same fence. Renewal requires the same `lease_version`, a live `lease_token`, state `RUNNING`, and a start time inside the 10 minute deadline. A replacement worker waits until `lease_until`. The kill test expires that timestamp after `SIGKILL` instead of sleeping 30 seconds. A retry or a recovered run whose `started_at` is older than 10 minutes ends `FAILED_FINAL` / `LIMIT_DURATION` without another model call. Resume does not insert a second proposal. The idempotency key is `${runId}:proposal`. Usage for the killed attempt is absent, and the resumed attempt records its own usage. Provider calls remain at-least-once.

## Remaining blockers

- A hosted cloud provider was not called. The passing real inference is local Ollama `gemma4:e4b`.
- Suppression and human ownership are not read from lead or conversation data. Unknown audience requires approval and does not allow the send.
- Quiet hours are not implemented.
- External delivery stays disabled on purpose. `APPROVED_NOT_EXECUTABLE` has no sender.
- Sprint 5 was not started.
