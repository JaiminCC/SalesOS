# SalesOS — Enterprise UI extension v2.1

## Purpose
This upgrade **extends the prior Next.js + Tailwind prototype**. It does not replace the AI Command Center, eight agent screens, Execution Inspector, lead discovery, campaigns, inbox, qualification, meetings, approvals, analytics, or products.

## Added clickable screens

| Menu screen | Tested interaction paths in local prototype |
|---|---|
| Authentication (before entering app) | Email + non-real demo password, remember-me, forgot password request, reset-form preview, MFA demo, SSO selection and continuation, logout |
| My Preferences | Name, currency, locale, IANA timezone, date/time, email signature, sending windows, notification toggles, digest, quiet hours, meetings preferences; formatted preview |
| Security Center | Require-MFA and SSO-only policy toggles, password/session timeout numeric controls, revoke individual demo sessions, sign out other demo devices |
| SSO & Authentication | Provider list, editable OIDC and SAML provider drafts, issuer/entity ID, client ID, domain, callback/ACS, scopes/attribute mapping, simulated provider test, disable |
| Users & Roles | Assign role, suspend/reactivate, create demo invitations, editable Manager/Sales permission matrix, custom role draft |
| Integrations | Nine connector manifests, provider-specific fields, one extra namespaced property, masked credential placeholders, save/delete, simulated test |
| WhatsApp AI | Business account details, bot policies, scripted test bench, conversation history, human handoff, template drafts, opt-in/opt-out demonstration, analytics |
| Webhooks | Add HTTPS URL drafts, enable/disable, simulate delivery, remove, signature/reliability policy descriptions |
| Audit Logs | Filter demo events, export CSV locally; event entries appended for settings/role/connector actions |

## Local demo authentication (NOT SECURE AUTHENTICATION)

1. Start the prototype and enter any syntactically valid email and any password of at least 8 characters. No password is sent to a server or saved.
2. Enter any six characters in the MFA demonstration. This is not genuine TOTP verification.
3. Remember me stores only a **fictional demo logged-in flag** in localStorage, not a bearer token or password. Nonremembered sessions use sessionStorage.
4. Sign out using the icon in the sidebar footer.
5. Forgot password generates a generic on-screen confirmation; it sends no email. The reset preview does not change real credentials.
6. SSO previews never redirect to a real identity provider.

Never use this demo for actual business users, sensitive customer data or real secrets.

## Real integration boundaries

- Connector settings are UI placeholders. Masked secret placeholders are persisted; **real access tokens, SMTP passwords and OAuth client secrets are not encrypted by this frontend**. Do not enter actual secrets.
- "Test" buttons record **simulated** results only. A connector must remain unverified until a backend completes a real authorized test.
- WhatsApp responses are scripted mock messages. Meta WhatsApp Business Platform access, permission and compliance are necessary for real messaging, template approval, webhook verification and delivery receipts.
- Audits are editable client-side records, not immutable legal audit evidence. Build backend append-only audit service, signed exports and tenant-safe access control.
- Permissions and SSO configurations are not enforced in the browser. Production authorization belongs in NestJS, identity service and PostgreSQL RLS policies.
- Meeting recordings and AI notes in the original prototype are simulation examples. Production meeting transcription must use authorized providers and appropriate participant disclosure/consent.

## Target production service contracts

- `POST /auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/password/request-reset`, `/auth/password/confirm-reset`, `/auth/mfa/verify`
- `GET/PUT /me/preferences`, `GET/PUT /tenant/settings`, `GET/PATCH /tenant/security`
- `GET/POST/PATCH /tenants/{tenantId}/identity-providers`, `POST /identity-providers/{id}/test`
- `GET/POST/PATCH /tenant/users`, `GET/PUT /tenant/roles/{roleId}/permissions`
- `GET/POST/PATCH /integrations`, `POST /integrations/{id}/test`, `POST /integrations/{id}/rotate-secret`
- `GET/POST/PATCH /webhooks`, `POST /webhooks/{id}/deliveries/test`
- `GET/PUT /channels/whatsapp/config`, `GET/POST /channels/whatsapp/templates`, `POST /channels/whatsapp/agent/test`
- `GET /audit`, `POST /audit/export`

All routes need auth, tenant isolation, RBAC, idempotency where appropriate, validation, rate-limits and security logging.

## Release blockers for a real enterprise SaaS

- Genuine password hashing, login throttling, session rotation/revocation, trusted MFA, recovery and secure cookie session handling
- Authenticated OIDC authorization code + PKCE with state/nonce checks, SAML signature/replay safeguards
- Encrypted secrets manager and per-tenant connector permissions
- PostgreSQL row-level tenant isolation, automated multi-tenant leakage tests
- Genuine Meta Cloud API and email/calendar connectors with provider receipt verification
- Verified webhook signature validation, replay prevention and allowlisted outbound requests
- Data retention, consent, opt-outs and international campaign legal policies
- Server-side, append-only audit events and SIEM-compatible logs
- Performance, resilience, accessibility and end-to-end browser testing

## How to evaluate manually

1. Start at sign-in and exercise invalid password, valid demo sign-in, MFA, logout, remember-me, password-reset preview and SSO selection.
2. Visit every new menu route; use tabs and change each control.
3. Reload and verify local changes persisted, then reset all demo data from the original Settings screen.
4. Configure SMTP (fake fields only) and verify status remains **Unverified**.
5. Configure an OIDC provider and verify status remains **Draft**, not Connected.
6. Run a WhatsApp bot sample and view the transcript in WhatsApp → Inbox.
7. Add a webhook draft using HTTPS; run the simulated test and verify no external request was made.
8. Invite a demo user, change role and permissions, and inspect the corresponding Audit Logs.
9. Confirm the preexisting Agent Control Center, Inbox, Execution Inspector, Campaigns and Meetings still appear in the navigation.
10. Run `npm run build` on a development machine with installed dependencies and then conduct actual browser E2E testing before deployment.
