# Mailbox capture webhook security

The capture webhook is a test hook. It is not a Gmail or Microsoft Graph subscription.

It is disabled unless `SALESOS_CAPTURE_WEBHOOK_ENABLED` is `true` and `SALESOS_CAPTURE_WEBHOOK_SECRET` is at least 32 characters. The API refuses to boot in production when the flag is `true`. `captureWebhookStatus` also returns disabled for `NODE_ENV=production` even if a caller constructs the check directly.

The signature is HMAC-SHA256 over the exact request bytes in `x-salesos-signature`. Comparison uses `timingSafeEqual`. A missing raw body, a forged signature, and a body that was re-serialized after parsing all fail closed.

The JSON `tenantId` is ignored. The tenant is the row returned by `lookup_capture_connection`, which matches a capture connection in `CAPTURE` status. An unknown id is rejected. A repeated `(tenant, provider, event id)` is `REPLAY`. Bodies larger than 8192 bytes are `TOO_LARGE`. Twenty receipts for one connection in a minute are `RATE_LIMIT`.

A recorded receipt uses status `RECORDED` and `sent: false`. The handler does not update a message to `SENT` or `DELIVERED`.

Google and Microsoft webhook routes stay `NOT_CONFIGURED`.
