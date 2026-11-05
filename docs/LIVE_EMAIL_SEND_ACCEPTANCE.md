# Live email send acceptance

| Level | What it proves | Result |
|---|---|---|
| 1 | Deterministic unit tests for the gate, digest, scopes, and adapter classification | Run with `pnpm test`. See `docs/SPRINT_7_TEST_RESULTS.md`. |
| 2 | HTTP stubs for Gmail and Graph, and a database test that injects a deliver callback | Run. Stub success is `STUB_TESTED`. |
| 3 | Live read-only mailbox sync against Google or Microsoft | **NOT TESTED.** No live account is connected. |
| 4 | Live send-scope OAuth without sending a message | **NOT CONFIGURED.** No OAuth client is configured. |
| 5 | One real message to an authorized recipient | **NOT AUTHORIZED.** This task does not approve a recipient or a send. |

`SALESOS_LIVE_EMAIL_SEND_ENABLED` was not set to true. Tenant policies created by the migration do not exist until a manager writes one, and the default columns are false. Mailbox `sending_enabled` stays false. No seed data turns sending on.

Do not treat a stubbed 200 or 202 as `LIVE_VERIFIED`.
