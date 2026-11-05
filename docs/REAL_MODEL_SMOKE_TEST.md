# Real model smoke test

**Date:** 5 November 2026  
**Result:** PASS for one local Ollama run. A hosted cloud provider was not called.  
**Model:** `gemma4:e4b`  
**Provider:** `ollama`

## Recorded run

The model was saved through Command Center as an Ollama configuration with loopback HTTP allowed. No Ollama account and no API key were used. The connection test succeeded. The endpoint and model name are stored on that configuration row. They are not defaults in source, seed data, or environment variables.

One Supervisor run used a published product version. An approved knowledge source was pinned into the snapshot. A rejected source was excluded. The run reached approval.

| Check | Result |
| --- | --- |
| Real inference | PASS |
| Provider and model stored on usage | `ollama`, `gemma4:e4b` |
| Usage source | `provider` |
| Published product context | PASS |
| Tool executions | PASS, eight tools, including `product.context.read`, `research.report.create`, `sales.strategy.generate`, `sales.message.draft`, and `action.proposal.create` |
| Citation provenance | PASS. The report cited the approved source. The rejected source was absent. |
| Approval without external delivery | PASS. The action is `APPROVED_NOT_EXECUTABLE` and `sent` is false. |
| Token counts | 267 input / 161 output, then 267 / 159, then 267 / 159 |
| Timing | Cold start 9.3 seconds, including 5.2 seconds to load the model. Later calls finished in about 2 seconds. |

The adapter changes that made this run finish are in `packages/agent-core/src/http-llm.ts`. The Ollama body sends the supervisor JSON schema, sets `think` to false, and limits `num_predict`. Usage reads `prompt_eval_count` and `eval_count`. Model steps allow 180000 ms. The run deadline is 600000 ms. The worker renews its lease every 10 seconds during the request.

This record does not include the credential, the session, or the document text.

## Earlier inventory

Before this run, environment key names matching `LLM`, `OPENAI`, `OLLAMA`, `ANTHROPIC`, `AZURE`, or `MODEL` were absent, and the stored rows were `fake`. That inventory did not include this later local configuration.

## Configuration for a later authorized test

Use a member with `agents.manage`. Sign in through the app. Open Command Center, then Models, then Add model. Leave the credential in the password field. The API encrypts it with the existing AES-256-GCM helper. A later `models/get` returns `configured: true` and `credentialHint` only.

Choose one provider:

| Goal | Provider value | Endpoint |
| --- | --- | --- |
| Hosted OpenAI-compatible | `openai_compatible` | HTTPS base URL, for example `https://api.openai.com/v1`. Leave loopback HTTP off. |
| Self-hosted OpenAI-compatible | `openai_compatible` | `http://127.0.0.1:<port>/v1` or `http://localhost:<port>/v1`, with **Allow loopback HTTP for this development endpoint** checked. The API must not be in production. |
| Ollama | `ollama` | `http://127.0.0.1:11434` in development, with the same loopback checkbox. A remote Ollama needs HTTPS. |
| Deterministic test | `fake` | No endpoint and no credential. This is the path already covered by CI. |

Save the row, open it, and use **Test connection**. That calls `POST /api/v1/management/models/test` with `{ "id": "<model id>" }`. Cookie requests also send `x-salesos-csrf: 1` and an allowed `Origin`. A success body includes `ok`, `provider`, `model`, and `traceId`. A failure is `MODEL_UNAVAILABLE`. The test prompt is one bounded `supervisor.ping` with `maxTokens` 50.

The same body can be posted as `models/create` by an authenticated client:

```json
{
  "name": "Authorized smoke",
  "provider": "openai_compatible",
  "model": "the-model-id",
  "baseUrl": "https://provider.example/v1",
  "apiKey": "the-credential",
  "allowPrivateHttp": false,
  "inputPriceMinorPerMillion": 0,
  "outputPriceMinorPerMillion": 0
}
```

Use `allowPrivateHttp: true` only for the loopback cases above. Do not put the credential in the browser URL, `localStorage`, or a response log.

## Workflow to record

1. Publish a product version through the existing product flow. Draft and rejected knowledge must stay out of the snapshot.
2. Start one run with `POST /api/v1/management/runs/create`:

```json
{
  "triggerType": "TEST",
  "productId": "<published product id>",
  "modelConfigurationId": "<the row just saved>",
  "goal": "Research the product and draft a message"
}
```

3. Read the run with `runs/get`. Record all of the following from the stored row and its `llm_usage` children:

- `modelProvider` and `modelName` match the saved row, not `fake`.
- `usageSource` is `provider` when the response included `prompt_tokens`, otherwise `estimated`.
- `inputTokens`, `outputTokens`, `traceId`, and `durationMs`.
- The execution `report` names the product and lists citation chunk ids from the pinned snapshot.
- Tool names include `product.context.read`, `research.report.create`, `sales.strategy.generate`, `sales.message.draft`, and `action.proposal.create`.
- Every `agent_actions.outcome.sent` is false. Approval, if taken, leaves the action `APPROVED_NOT_EXECUTABLE`.

4. If the provider call fails, record the HTTP status and the run state from the table in `docs/SPRINT_4_2_COMPLETION.md`. Do not mark the smoke passed because a stub or the Mock provider succeeded.

## Evidence that does not count

- `FakeLlmProvider` output, including the Playwright run saved as `Local mock`.
- The loopback stub in `gateway.spec.ts`, including the fixture string `stub-secret`.
- A run whose `model_provider` is `fake` or whose usage row was estimated by the mock adapter.
