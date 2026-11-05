# Agent execution limits

Defaults in `packages/shared/src/limits.ts`:

| Limit | Value |
| --- | --- |
| Steps | 12 |
| Tool calls | 8 |
| Model calls | 4 |
| Run duration | 600000 ms |
| Output tokens | 800 |
| Input tokens | 6000 |
| Provider retries | 1 |
| Active runs per organization | 5 |

Model tools allow 180000 ms for one provider request. A stored constraint can shorten the run deadline. It cannot raise it above 600000 ms. Every claim checks `started_at` against that deadline, including a retry from `FAILED_RETRYABLE` and a run resumed after a worker crash. A result that returns after the deadline is stored as failed usage and the run ends `FAILED_FINAL` / `LIMIT_DURATION`. Lease renewal also stops once the deadline has passed.

Before a model step, `reserveModel` adds the configured price for the maximum input and output onto `usage_counters` for the UTC month. If spent plus reserved plus that estimate exceeds `llm_monthly_budget_minor`, the run ends `FAILED_FINAL` / `LIMIT_QUOTA` and the model is not called. After the call, the reservation is released and the calculated cost is added to spent. A zero price still reserves 1 minor unit so a zero budget cannot start a model step.

`estimateCostMinor` divides token counts by one million before applying the per-million rate. A missing provider usage object is stored as `estimated`.
