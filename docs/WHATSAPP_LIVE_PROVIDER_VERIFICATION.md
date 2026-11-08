# WhatsApp live provider verification

| Check | Status |
|---|---|
| Local schema, RLS, webhook HMAC, conversations, drafts | IMPLEMENTED |
| Signed local fixtures | STUB_TESTED |
| Live Meta app and WABA | NOT_CONFIGURED |
| Authentic provider webhook | NOT_TESTED |
| Live WhatsApp send | NOT_AUTHORIZED |
| Meta template submission | NOT_AUTHORIZED |
| Real Ollama WhatsApp acceptance | TESTED. Local `gemma4:e4b` returned a reviewable draft. Origin `STUB_TESTED`. Zero sends. |

No fixture is labeled `REAL_PROVIDER`. `PROVIDER_APPROVED` cannot be stored. Overview counts for provider-approved templates and real provider statuses are zero. Fixture status rows are counted separately.

These labels are not local implementation failures. Live connectivity needs an authorized Meta app, a WABA, a phone number, and a later explicit send decision.
