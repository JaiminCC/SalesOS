# Sprint 10 completion

Sprint 10 adds a multi-tenant WhatsApp Business foundation. Signed-in screens read PostgreSQL through the management API. Live sending stays closed.

Implemented:

- Tenant connections, phones, credentials, conversations, inbound messages, statuses, consents, templates, drafts, approvals, assignments, alerts, and webhook receipts.
- Forced row-level security on every tenant WhatsApp table.
- Global ingress deduplication without message text.
- GET handshake and POST HMAC verification on the raw body.
- Durable receipt and outbox processing.
- CRM phone matching, opt-out suppression, a 24-hour window, and human takeover.
- The `WHATSAPP_ANALYZE_AND_DRAFT` plan. No send tool is registered.
- Local template drafts that cannot be stored as `PROVIDER_APPROVED`.
- A Cloud API adapter that throws before any network call.
- Operations counts from tenant rows, with live labels fixed as not configured, not tested, and not authorized.

Not in this sprint:

- Embedded Signup code exchange.
- Automatic Meta template submission.
- Media download.
- A live Meta app, WABA, or webhook subscription.
- Outbound WhatsApp delivery.
- Calendar booking or billing.

Graph API default is `v27.0`, chosen from Meta pages cited on 5 November 2026. The changelog request timed out, so a newer version was not guessed. Versions outside `v22.0` through `v27.0` are rejected.

Local foundation: PASS. Live Meta: NOT CONFIGURED. Real webhook: NOT TESTED. Live WhatsApp send: NOT AUTHORIZED.
