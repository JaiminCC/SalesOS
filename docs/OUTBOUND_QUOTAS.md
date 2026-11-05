# Outbound quotas

Defaults stay conservative and are not created as an enabled policy. A missing `email_send_policies` row means tenant sending is off.

| Limit | Column | Default | What it counts |
|---|---|---|---|
| Mailbox hourly | `hourly_cap` | 20 | Holding reservations for that connection in the current UTC hour |
| Mailbox daily | `daily_cap` | 100 | Holding reservations for that connection on the current UTC date |
| Tenant daily | `tenant_daily_cap` | 100 | Holding reservations for the tenant on the current UTC date |
| User hourly | `user_hourly_cap` | 10 | Holding reservations for that user in the current UTC hour |
| Recipients | `max_recipients` | 5 | Unique normalized To, Cc, and Bcc addresses |

The management policy endpoint accepts `enabled` and `killSwitch` only. It cannot set caps. A send request has no quota fields.

Windows are UTC. `hour_start` is the UTC hour and `day_start` is the UTC date. Contact quiet hours still use `crm_contact_policies.timezone`. The quota windows do not.

Recipient addresses are trimmed and lowercased. The same address in To, Cc, and Bcc counts once. An empty address, a header-unsafe address, or an address that fails `^[^@\s]+@[^@\s]+$` marks the set invalid and blocks the send. An empty recipient set is invalid.

Contact frequency is separate from those caps. When `minimum_interval_hours` is greater than 0, a holding reservation with the same `contact_key` inside that interval blocks the next send. `contact_key` is the first normalized recipient. `max_attempts` counts holding reservations for that key on the UTC day. Zero interval hours disables only the interval check.

Holding states are `RESERVED`, `ACCEPTED`, and `UNCERTAIN`. `RELEASED` does not consume capacity. The policy row is locked with `FOR UPDATE` inside the claim transaction, so concurrent workers share one count. A definitive provider rejection moves the reservation to `RELEASED`. An uncertain outcome stays `UNCERTAIN` and keeps the capacity until reconciliation or an authorized investigation. Investigation does not release it and does not mark the message delivered.

`email_send_quotas.accepted_count` increases only when an attempt becomes `PROVIDER_ACCEPTED`. Provider HTTP 429 is `UNKNOWN`, keeps the reservation, and is not turned into another request. Gmail and Graph quotas are not assumed to be equal.
