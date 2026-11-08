# Sprint 10 implementation plan

Sprint 10 is a generic multi-tenant WhatsApp Business foundation. Live sending is not part of the sprint.

| Feature | UI | API | Database | Worker | RBAC | Provider | Tests |
|---|---|---|---|---|---|---|---|
| Readiness | Overview | `whatsapp/overview` | connection readiness | health job name reserved | `whatsapp.conversations.read` | env only, no Graph call | shared readiness spec |
| Connection | Add/list | `connections/*` | `whatsapp_connections`, encrypted `whatsapp_credentials` | none | `whatsapp.connections.manage` | manual mode stays unverified | database spec |
| Phone map | Phones | `phones/*` | unique `provider_phone_id`, outbound false | resolve function | `whatsapp.connections.manage` | id is not trusted as verified | cross-tenant reject |
| Webhook | none | `GET/POST /webhooks/whatsapp` | `whatsapp_ingress`, `whatsapp_webhook_receipts` | `whatsapp.webhook.process` | signature, not a session | HMAC of the raw body | API integration |
| Conversation | List and detail | `conversations/*` | conversations, messages | idempotent process | read vs `messages.read` for body | fixture origin only | database spec |
| CRM link | Detail | `conversations/link` | `whatsapp_contact_links` | phone HMAC match | `whatsapp.conversations.manage` | no name merge | database spec |
| Consent | Detail | stored from STOP | `whatsapp_consents`, CRM suppression | opt-out rule | `whatsapp.consent.manage` for manual changes | exact command only | database spec |
| Window | Detail | derived | `window_state` | recompute from inbound time | read | fixture time is not live proof | shared spec |
| Takeover | Detail buttons | `conversations/assign` | `whatsapp_assignments` | blocks drafts | `whatsapp.conversations.manage` | none | database path |
| AI draft | Generate suggestion | `drafts/prepare` and supervisor plan | draft versions | agent run | `whatsapp.drafts.create` | no send tool | source scan |
| Approval | Reviewer | `drafts/decide` | `whatsapp_approvals` | does not dispatch | `whatsapp.drafts.review`, author separated | no provider call | database spec |
| Templates | Add/list | `templates/*` | versions, provider status unknown | validate job name reserved | `whatsapp.templates.manage` | submission throws | check constraint |
| Operations | Overview and alerts | `alerts/*`, `events/*` | alerts, provider errors | process pending | `whatsapp.operations.*` | unmapped events stay global and body-free | API and e2e |
| Closed gate | Banner | no send route | outbound check false | worker has no send call | tenant admin cannot override | `sendWhatsAppCloudMessage` throws | nosend spec |

Statuses used in the docs: IMPLEMENTED for the local foundation, STUB_TESTED for signed fixtures, NOT_CONFIGURED for a live Meta app, NOT_TESTED for a real webhook, and NOT_AUTHORIZED for sending.
