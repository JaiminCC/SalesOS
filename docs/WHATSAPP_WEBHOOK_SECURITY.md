# WhatsApp webhook security

`GET /api/v1/webhooks/whatsapp` checks `hub.mode=subscribe` and compares `hub.verify_token` with `META_WEBHOOK_VERIFY_TOKEN` using a length check and `timingSafeEqual`. Only then does it return `hub.challenge` as `text/plain`. A mismatch returns 403 and the word `rejected`.

`POST` does not use a session or a CSRF token. A session cookie on the same host does not replace the signature and does not block a valid signature. It requires `content-type: application/json`, a body of at most 1,048,576 bytes, and `X-Hub-Signature-256`. The signature is `sha256=` plus the hex HMAC-SHA256 of the exact raw body using `META_APP_SECRET`. The comparison is timing-safe and rejects a different length before it compares. Invalid signatures return 401 and are not parsed into business events.

The route allows 60 requests a minute for each source address. The counter is a Redis key named `wa:webhook:` plus a SHA-256 of the source address. The key does not contain the message body. The increment and expiry run in one Redis script. If Redis is unreachable, the route returns 503 and does not accept the webhook. Worker delivery retries are bounded at five attempts. Nested payloads deeper than eight levels and more than 50 messages are rejected. Logs must not include the app secret or message text. The handler returns a structured error and no stack trace.

The webhook does not accept a tenant id. `resolve_whatsapp_phone` maps `metadata.phone_number_id` to the tenant that already owns that provider id. An unknown id is stored on `whatsapp_ingress` as `QUARANTINED` without the message body.

Status: signature checks are IMPLEMENTED and STUB_TESTED. A webhook delivered by Meta is NOT_TESTED.
