# WhatsApp architecture

The signed-in desk is `apps/web/components/management/WhatsAppDesk.jsx`. The API is `apps/api/src/whatsapp`. Policy lives in `packages/shared/src/whatsapp.ts`. Persistence lives in `packages/database/src/whatsapp-work.ts`. The closed adapter is `packages/integrations/src/whatsapp-cloud.ts`.

Onboarding has two prepared modes. Manual configuration stores a WABA id and phone id as `CONFIGURED_UNVERIFIED` or `UNVERIFIED`. Embedded Signup returns `AUTHORIZATION_REQUIRED` only when `META_EMBEDDED_SIGNUP_CONFIG_ID` is set, and it does not exchange a code or call Meta in this sprint. Neither mode is reported as verified.

Inbound processing order: verify signature, parse the envelope, persist `whatsapp_ingress`, persist a tenant receipt when the phone is mapped, write `whatsapp.webhook.process.v1`, then let the worker or `events/process` create one conversation and one inbound message. AI suggestions are internal drafts. Approvals do not call the provider.

Outbound is unreachable. The adapter throws before constructing a request. Database checks keep `outbound_enabled` false and message direction inbound. The email send path is unchanged.
