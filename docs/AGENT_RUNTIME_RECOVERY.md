# Agent runtime recovery

`advanceAgentRun` commits one checkpoint at a time. A local tool finishes inside the claim transaction. A model call runs after commit. The result is written only when `lease_version` still matches and the run is `RUNNING`.

The claim sets `lease_token`, increments `lease_version`, and holds `lease_until` for 30 seconds. While a model request is in flight, the worker renews that lease every 10 seconds. Renewal updates `lease_until` only when `lease_version` still matches, `lease_token` is still set, the run is `RUNNING`, and `started_at` is inside the 10 minute deadline. A request that lasts up to 3 minutes therefore keeps its lease. Cancel and pause increment `lease_version` and clear the token, so a renewal and the later save both fail the fence. The lease is cleared after the step commits so the same worker can take the next step.

A crashed worker can leave a step unfinished. The next `advanceAgentRun` continues from succeeded tool rows. Model calls are at-least-once: a provider that cannot deduplicate may see a repeated request after recovery. This runtime does not claim exactly-once model execution.

`apps/worker/src/recovery.spec.ts` starts `crash-checkpoint.ts` in a child process, that process exits 1 after one checkpoint, and the parent finishes the same run. A second pass does not add model calls. The same file covers quota refusal, a cancel that lands during the model callback, and a membership that lost `agents.manage`.
