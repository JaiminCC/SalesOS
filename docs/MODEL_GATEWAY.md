# Model gateway

Sprint 4.1 selects a model only from a stored `model_configurations` row. `FakeLlmProvider` is constructed when that row's provider is `fake`. A failed or disabled provider is recorded as `FAILED_RETRYABLE` or `FAILED_FINAL`. The worker and API do not substitute the mock.

## Providers

| Stored provider | Adapter | Network |
| --- | --- | --- |
| `fake` | `FakeLlmProvider` | None. Test and CI selection. |
| `openai_compatible` | `HttpStructuredLlm` chat-completions body | HTTPS, or loopback HTTP only when the row sets `allow_private_http` and the process is not production. |
| `ollama` | Same HTTP class, Ollama `/api/chat` body | Same endpoint rules. |

`createModelClient` in `packages/agent-core/src/gateway.ts` is the only constructor. `assertModelEndpoint` rejects embedded credentials, non-HTTPS public URLs, metadata and link-local addresses, and private ranges. HTTP redirects are not followed. Responses are capped at 200000 characters. Timeouts use `AbortSignal.timeout`.

## Credentials

`POST /api/v1/management/models/create` and `models/update` encrypt `apiKey` with the existing AES-256-GCM field helper. Responses return `configured: true` and `credentialHint` (last four characters). They do not return the ciphertext or the plaintext. Test connection calls the selected adapter and returns its result. The mock answers only when the row says `fake`.

## Usage

`llm_usage.usage_source` is `provider` when the response includes `prompt_tokens`, or Ollama's `prompt_eval_count` and `eval_count`. Otherwise it is `estimated`. Cost uses `estimateCostMinor` with the row's price per million tokens. Token counts are not stored as currency.

The Ollama request asks for the supervisor JSON schema, disables thinking, and sets `num_predict` from the step token limit. Production defaults stay the Mock provider. The form starts with provider `fake` and model `fake-1`. No endpoint, model name, credential, or local workspace is compiled in.

A local Ollama run is recorded in `docs/REAL_MODEL_SMOKE_TEST.md`. No hosted cloud credential is configured.
