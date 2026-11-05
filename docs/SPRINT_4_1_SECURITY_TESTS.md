# Sprint 4.1 security tests

Live provider smoke: **NOT TESTED**. The environment has no model API key. CI uses the explicit `fake` provider and a loopback HTTP stub.

| Check | Result | Evidence |
| --- | --- | --- |
| Mock adapter is explicit | PASS | `gateway.spec.ts` rejects an OpenAI-compatible client with no endpoint and does not return the fake adapter. |
| Loopback HTTP stub, 429, malformed JSON, redirect | PASS | `gateway.spec.ts` against `127.0.0.1`. |
| Metadata and public HTTP blocked | PASS | `assertModelEndpoint` cases in `gateway.spec.ts`. |
| Credential redaction | PASS | `agents.integration.spec.ts` sends `apiKey` and asserts the response body does not contain it. |
| Cross-tenant model and run | PASS | Same spec, other organization receives 404. |
| Draft version rejected | PASS | Same spec, status 409. |
| Approval digest and replay | PASS | Wrong digest 409, second decision 409, action `APPROVED_NOT_EXECUTABLE`, `sent: false`. |
| Policy version retained | PASS | Same spec after `policies/update`. |
| Sort injection | PASS | `sortBy` with SQL text returns 400. |
| Prompt text does not add tools or a send | PASS | `recovery.spec.ts` stores an excerpt that says to send mail. The tool list stays the plan and no action is sent. |
| Quota | PASS | Budget 0 ends `LIMIT_QUOTA` with zero model calls. |
| Cancel during model callback | PASS | Lease increment leaves the run `CANCELLED`. |
| Role removal | PASS | Deleting the membership role ends `AUTHZ_REVOKED`. |
| Worker process kill | PASS | Child `crash-checkpoint.ts` exits 1. Parent completes the run once. |
| Cost units | PASS | `limits.spec.ts`: 1,000,000 input tokens at 200 per million is 200, not 1,000,000. |

Not covered by a new test: viewer HTTP denial, concurrent approval races with two transactions, and a paid provider. Viewer controls are hidden in the management desks when the permission is absent. Concurrent approval uses one conditional `updateMany`.
