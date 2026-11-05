# AI inbox intelligence

`INBOX_ANALYZE_AND_DRAFT` is a supervisor plan. The steps are `inbox.thread.read`, `inbox.message.read`, `inbox.intent.classify`, `inbox.crm.context.read`, `inbox.product.context.read`, `inbox.thread.summarize`, `inbox.reply.propose`, `inbox.draft.create`, and `inbox.eligibility.evaluate`.

Each tool is tenant-scoped, `external: false`, and has no send approval. Summarize and propose are model steps. The prompt states that message text is untrusted and does not authorize sending. `inbox.draft.create` stores one editable draft from the proposal. When the model provider is `fake`, the analysis row leaves `model_provider` null so the text is not labeled as a live model.

Intent classification in the sync path is deterministic: unsubscribe, a question mark, or a note. It does not grant consent or eligibility.

`POST /api/v1/management/inbox-ai/run` creates an agent run with that plan. It still requires a published product and a model configuration, the same as other supervisor runs. This sprint did not run the plan against Ollama. A fake provider result must not be described as live model output.

The plan cannot send mail. `inbox.eligibility.evaluate` returns the current facts and `externalSend: false`.
