# Sprint 10 final acceptance

## Local foundation

PASS. The schema, forced RLS, readiness labels, encrypted credential storage, webhook HMAC, durable receipts, deduplication, inbound persistence, CRM linking, consent, service window, takeover, AI plan, draft approval, template versions, closed-gate adapter, operations screens, and worker recovery are implemented and covered by the suites in `docs/SPRINT_10_TEST_RESULTS.md`.

The signed-in browser test opens WhatsApp, checks the three not-authorized labels, validates an empty connection, saves a connection and phone, posts a signed fixture, processes it, shows the customer number, finds no Send button, and keeps the connection after refresh in a second tab. The address has no database id.

The browser script does not click conversation detail, consent, a separate reviewer, template history, alert acknowledgement, or a second organization. Those behaviors are covered by the database and API tests.

The SIGKILL test kills the worker before the receipt and during the message write, then a replacement worker stores one message. It does not separately kill every later pause point. Those pause points exist in the processor. Outbound count stays zero. A suspended tenant stops before the write.

## Activation blockers

These are required before a live WhatsApp connection. They are not local implementation failures.

- Embedded Signup does not exchange an authorization code.
- No Meta app, WABA, or phone number is connected.
- No genuine provider webhook has been received.
- Templates are not submitted to Meta, and none are Meta-approved.
- Media is stored as deferred and is not downloaded.
- Delivery to a real handset is unverified.
- Outbound sending stays disabled. There is no automated live reply.
- The public webhook requires Redis. An outage fails closed with 503.
- The browser test does not click conversation detail, consent, a second reviewer, template history, alert acknowledgement, or a second organization.

## Separate live acceptance

| Check | Result |
|---|---|
| LIVE META | NOT CONFIGURED |
| REAL WEBHOOK | NOT TESTED |
| LIVE WHATSAPP SEND | NOT AUTHORIZED |
| REAL OLLAMA | TESTED with local `gemma4:e4b` on fixture data. The stored draft source was `MODEL`. Nothing was sent. |

These live labels are not local implementation failures.

Sprint 11 has not started. The tree was not committed and was not pushed.
