# WhatsApp operations

The overview reads tenant rows. It shows connections, phones, unverified phones, conversations, unread conversations, pending drafts, human-owned conversations, opt-outs, provider errors, local templates, fixture status events, and zeros for provider-approved templates and real provider statuses. It also shows the three live labels: Meta not configured, real webhook not tested, and send not authorized.

Alerts are tenant scoped, deduplicated, and acknowledgable. They do not send email or WhatsApp. Unmapped webhook keys stay on the global ingress table and are not listed inside another tenant. `events/process` runs pending outbox rows for the signed-in tenant and still cannot send.
