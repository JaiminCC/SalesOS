# Sprint 10 security review

Reviewed the closed-gate adapter, webhook HMAC, tenant phone mapping, RLS grants, prompt-injection handling, approval separation, and the unchanged email send gate.

Findings:

- No reachable WhatsApp or template submission network call was added. Both functions throw `WHATSAPP_SEND_NOT_AUTHORIZED`.
- Webhook signatures are checked on the raw body before the envelope is trusted. Invalid signatures are not queued.
- Public webhooks do not take a tenant id. Unmapped phone ids are quarantined without message text.
- The same provider phone id cannot belong to two tenants.
- Inbound text that says to ignore instructions and send is stored as user data. The draft fallback is deterministic and is not sent.
- The draft author cannot approve. Approval does not dispatch.
- `PROVIDER_APPROVED` cannot be written.
- Test and CI cannot set `SALESOS_LIVE_WHATSAPP_SEND_ENABLED=true`. The email flag behavior is unchanged.
- Tenant tables are forced-RLS. Ingress has no tenant column and no message body. Application and worker roles cannot select the table. They can address one row through the directory-owned functions.
- `salesos_directory` already has `BYPASSRLS` from the membership directory. Sprint 10 does not add another bypass. Removing the existing attribute would break earlier membership lookups, so it was left in place. The phone resolver returns only a tenant id, connection id, and phone id.
- The public webhook rate limit is a Redis window keyed by a hash of the source address. A Redis outage returns 503 and does not queue the body.
- Credentials are encrypted. Management responses do not return the token.

Residual risk: a deployment that later removes the throw in `whatsapp-cloud.ts` could send if it also builds a request. That change is outside Sprint 10 and would still need the flag, a tenant override prohibition, and a separate authorization review. Real Meta delivery remains not authorized.
