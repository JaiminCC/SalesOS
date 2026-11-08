# WhatsApp data model

Tenant tables use composite primary keys `(tenant_id, id)`, forced row-level security, and `tenant_isolation`. See `docs/DATABASE_DESIGN.md` section 18.

`whatsapp_ingress` is the only WhatsApp table without `tenant_id`. It deduplicates event keys globally and does not store message text. The tenant receipt stores the parsed event. Messages reference a conversation. Status rows are immutable and unique per provider message and status. The displayed status is the highest of `failed`, `sent`, `delivered`, and `read`. An older later event does not erase a higher one. An unmatched status becomes a provider error and does not create an outbound message.

Credentials store ciphertext and a hint. Connections and phones cannot set outbound enabled. Template versions cannot store `PROVIDER_APPROVED`.
