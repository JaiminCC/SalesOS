# SALESOS ENTERPRISE EXTENSION — AUTHENTICATION, CONFIGURATION, WHATSAPP & GOVERNANCE
## Addendum to Code Colonies SalesOS AI-First BRD, SRS and Technical Architecture

**Version:** 2.0 | **Date:** 4 November 2026 | **Owner:** Code Colonies Private Limited | **Classification:** Internal engineering handoff

> **Status:** This document specifies requirements, proposed defaults and acceptance criteria; the visual boards are conceptual reference images, not implemented screens or proof of a running integration. The architecture is multi-tenant and vendor-neutral, and must not hardcode any specific Code Colonies product.

## 1. BUSINESS REQUIREMENTS AND SCOPE

**BR-E01 — Enterprise readiness.** Organizations must authenticate through local credentials or supported federated identity, administer roles, audit events, and enforce per-tenant policies without modifying application code.

**BR-E02 — Fully configurable experience.** Users and tenant admins control locale, dates, timezone, business hours, email preferences, notifications, brand, agent policies, customer qualification rules and integration-specific values according to permissions.

**BR-E03 — Extensible connectors.** Every third-party connector is defined by a versioned provider manifest, validated credential schema, editable configuration, capability set, OAuth/scopes or API credentials, webhook configuration, health tests, error reporting and audit history. Arbitrary secret fields are not permitted to bypass server-side validation.

**BR-E04 — WhatsApp business conversations.** Allow businesses with authorized Meta WhatsApp Business Platform access to receive messages, route conversations to AI or humans, send appropriate replies, manage approved templates, observe messaging windows, handle opt-outs and monitor delivery outcomes.

**BR-E05 — Autonomous but accountable.** The Supervisor can autonomously act only through policy-gated tool interfaces. Tenant-level and agent-level permissions must be checked again server-side before any external side effect. Nothing bypasses compliance, consent or authorization rules by using a different channel.

**BR-E06 — Secure enterprise evidence.** Identity actions, configuration changes, connector use, AI decisions and outgoing messages must produce attributable, tenant-isolated audit events. Sensitive values must not appear in logs, exports or UI screenshots.

### 1.1 Priorities and delivery boundaries

| Priority | Functionality | Delivery gate |
|---|---|---|
| P0 internal MVP | Email/password or existing SSO provider; reset flows; session security; roles; base preferences; connector framework; email; WhatsApp webhook adapter in sandbox; logs | Release after security and consent tests |
| P1 enterprise pilot | Multiple OIDC providers; SAML through proven library/broker; MFA and recovery; SCIM; WhatsApp production template management; tenant data exports; secure webhooks | Pilot customer and specialist security review |
| P2 enterprise scale | Advanced conditional access, just-in-time provisioning, data residency, retention hold, enterprise SIEM, provisioning workflows, tenant-managed encryption keys | Enterprise requirement and paid roadmap |

**Non-goals in MVP:** universal WhatsApp/LinkedIn messaging access; turnkey compliance certification; transparent recording of meetings without participant permission; unlimited service-provider connectors at zero cost; passwordless magic link without abuse controls; universal provider properties known in advance.

## 2. ENTERPRISE UI/UX SCREEN REGISTER

Screen IDs are stable engineering identifiers. Each screen must provide loading, error, empty, offline/expired-session and access-denied variants as appropriate. Buttons must not claim success before server confirmation.

| ID | Route suggestion | Screen | Mandatory user interaction |
|---|---|---|---|
| AU-01 | /auth/login | Enterprise sign in | Email/password, show/hide, remember device/session, SSO redirect, errors |
| AU-02 | /auth/forgot-password | Forgot password | Generic confirmation even if account does not exist, resend throttling |
| AU-03 | /auth/reset-password | Reset password | One-use link, new password, confirm, expired/used token states |
| AU-04 | /auth/mfa | Verify second factor | TOTP/passkey or recovery code, retry/lockout, remember trusted device policy |
| AU-05 | /auth/sso | Choose organization/provider | Domain-based discovery, OIDC/SAML entry, safe redirect, failure states |
| AU-06 | /auth/invite | Accept invitation | Verified tenant invitation, membership acceptance, expiration |
| AU-07 | /auth/locked | Locked/suspended account | Non-disclosing support path and retry/administrative unlock |
| AU-08 | /auth/recovery | Recovery and emergency access | Backup codes, admin emergency workflow, notifications |
| ST-01 | /settings/profile | User profile | Name, avatar, language, contact info, accessibility |
| ST-02 | /settings/preferences | Regional preferences | IANA timezone, locale, date/time/number/currency format, week start |
| ST-03 | /settings/notifications | Notification preferences | Per-event email/in-app/digest and quiet hours |
| ST-04 | /settings/email | Email preferences | Sender identity, signature, reply-to, thread rules, sending window |
| ST-05 | /settings/organization | Tenant settings | Name, domain, branding, business hours, defaults and subdomain |
| ST-06 | /settings/users | Users and invitations | Invite, deactivate, role assignment, bulk status, last activity |
| ST-07 | /settings/roles | Roles and permissions | Permission matrix, custom role policies, effective permissions |
| ST-08 | /settings/security | Security policies | MFA enforcement, SSO-only, password, lockout, session settings |
| ST-09 | /settings/sessions | Active devices and sessions | Device, IP approximation, last active, revoke, sign out everywhere |
| ST-10 | /settings/sso | Identity providers | OIDC/SAML setup, test, certificate rotation, domains, JIT, SCIM |
| ST-11 | /settings/audit | Security audit logs | Search/filter, event detail, export permission, retention |
| ST-12 | /settings/data | Privacy & retention | Export, delete workflows, retention, masking and residency flags |
| IN-01 | /integrations | Connector catalog | Search/filter by category/capability, install, show status |
| IN-02 | /integrations/new | Add custom connector | Select manifest template, allowed properties and auth mode |
| IN-03 | /integrations/:id | Connector configuration | Dynamic settings form, masked credentials, tests, scopes, logs |
| IN-04 | /integrations/:id/webhooks | Webhook manager | Endpoint, signature validation, secrets rotation, replay, failures |
| IN-05 | /integrations/:id/mappings | Field/event mapping | Source-to-domain schema, transformations, preview and validation |
| IN-06 | /integrations/:id/logs | Connector operations | API errors, retries, health, quotas, billing hints |
| WA-01 | /channels/whatsapp | WhatsApp overview | WABA connection, number status, activity, quality/rate flags |
| WA-02 | /channels/whatsapp/bot | AI bot configuration | Knowledge selection, automation level, fallback and escalation |
| WA-03 | /channels/whatsapp/inbox | WhatsApp inbox | Media/text messages, AI/human switch, source message IDs |
| WA-04 | /channels/whatsapp/templates | Approved templates | Locale, category, variables, provider approval status |
| WA-05 | /channels/whatsapp/flows | Bot workflows | Intent → policy → AI action → reply/escalate visual flow |
| WA-06 | /channels/whatsapp/opt-ins | Consent and preferences | Opt-in evidence, purpose, unsubscribe, consent withdrawal |
| WA-07 | /channels/whatsapp/insights | Channel analytics | Response latency, handoffs, delivery failure, opt-outs |
| AG-01 | /agents | Agent control center | Agent statuses, approvals, scopes, models, prompt versions |
| AG-02 | /agents/:id | Agent detail | Inputs, outputs, tools, autonomy, memory, budget and audit |
| AG-03 | /agents/runs/:id | Execution inspector | Trigger, evidence, planning, policy verdict, tool receipt, retry |
| AG-04 | /approvals | Human approval inbox | Approve/reject/reassign, reason and immutable action record |
| MT-01 | /meetings/:id/intelligence | Meeting intelligence | Recording disclosure, transcript, notes, action ownership |

### 2.1 Layout/design language

Desktop: 240px persistent sidebar, compact top navigation, 12-column content grid, detail inspector drawer. Mobile: collapsible navigation and one-column cards. Design tokens: primary violet #673DE6, dark navy #161633, teal success #0D9488, surfaces #FFFFFF/#F6F7FC; minimum AA contrast for body text and focus outlines. Support dark/light/system theme, reduced-motion and keyboard navigation. The accompanying boards illustrate visual direction, not literal production strings or actual lead counts.

## 3. AUTHENTICATION SRS (AU)

| ID | Priority | Functional requirement | Acceptance criteria |
|---|---|---|---|
| AU-FR-001 | P0 | Local sign-in with verified email, Argon2id password hashing, normalized identity | Invalid and nonexistent login yield equivalent public response; no plaintext credentials stored |
| AU-FR-002 | P0 | Forgot password flow uses random one-use expiring token stored as hash | Token replay and post-expiry requests fail; no account enumeration; reset invalidates other reset links |
| AU-FR-003 | P0 | Successful reset revokes existing sessions and notifies account owner | Previously valid sessions return 401; notification does not expose secrets |
| AU-FR-004 | P0 | Remember me controls session persistence, not browser credential storage | Disabled uses short default session; enabled uses policy-defined maximum and device visibility |
| AU-FR-005 | P0 | Secure session cookies with HttpOnly, Secure, SameSite and CSRF defense as required | Stolen/expired/revoked token fails; logout revokes server-side session |
| AU-FR-006 | P0 | Tenant isolation for all authentication memberships | Valid user cannot access another tenant via manipulated tenant_id/header |
| AU-FR-007 | P1 | OIDC Authorization Code + PKCE SSO, issuer/audience/nonce/state verification | Mismatched state, signature, nonce or redirect rejected; domain claim validated |
| AU-FR-008 | P1 | SAML 2.0 via vetted implementation, ACS URL, signed assertions, replay protection | Invalid signature, audience, InResponseTo, timestamp and duplicate assertion rejected |
| AU-FR-009 | P1 | MFA with TOTP and WebAuthn passkeys; secure recovery codes | Reuse of recovery code rejected; step-up access required for sensitive actions |
| AU-FR-010 | P1 | Admin-managed SSO-only and MFA policies by tenant | Policy enforced for new and existing sessions; emergency break-glass audited |
| AU-FR-011 | P1 | Identity lifecycle: invitation, join, suspend, remove, SCIM optional | Deactivated user loses all sessions and tokens immediately |
| AU-FR-012 | P0 | Rate limit, suspicious-login detection, backoff and lockout without easy denial-of-service | Automated attack simulations throttled; support recovery path remains available |
| AU-FR-013 | P0 | Configurable inactivity/absolute session limits and concurrent-session policy | Session obeys documented limits and tenant defaults; device revocation propagates |
| AU-FR-014 | P1 | Audit IP, user-agent, auth factor and outcome with minimized data | Viewable by permitted security admin; no passwords, raw session tokens or OTP secrets logged |

**Proposed default policies (tenant overridable with minimum security floor):** password minimum 12 characters when local sign-in is allowed, breached-password check where feasible, no forced periodic rotation without a security reason, TOTP or passkey for privileged accounts, 30-minute inactivity / 12-hour absolute admin sessions, 7-day normal user absolute session, optional remember-device up to 30 days based on risk and tenant policy, reset link TTL 15 minutes, 5 failed login attempts per account/IP window with adaptive controls. These require final security risk assessment; do not represent one-size-fits-all standard requirements.

**SSO account linking:** only link a federated identity after checking stable provider `sub`/NameID and explicit secure linking policy; never auto-link solely because a raw email matches. Organization discovery must resist tenant enumeration. Support multiple providers per tenant behind configuration but allow tenant-approved defaults. Test without activating globally.

## 4. USER AND ORGANIZATION PREFERENCES

Preference resolution order: `user override -> tenant default -> product default`. Server stores UTC timestamps; API responses use ISO 8601 with offset or UTC; UI renders using IANA timezone. Do not persist fixed GMT offsets as the user timezone because daylight-saving rules change.

| Property | Type / example | Scope | Validation and behavior |
|---|---|---|---|
| display_name | UTF-8 string | User | Length limit, escaping |
| locale | `en-IN` | User/tenant | BCP 47 identifier |
| timezone | `Asia/Kolkata` | User/tenant | Valid IANA timezone |
| date_format | `dd/MM/yyyy` | User/tenant | Allowed format tokens only |
| time_format | `12h` / `24h` | User/tenant | Explicit selection |
| week_starts_on | `monday` | User/tenant | Enumerated |
| currency | `INR` | Tenant/user display | ISO 4217 code |
| number_format | `en-IN` | User | Locale-based grouping |
| theme | `light`,`dark`,`system` | User | Accessible contrast |
| reduced_motion | boolean | User | Respect accessibility setting |
| language | `en` | User | Supported language catalog |
| email_signature | sanitized rich text | User/tenant | Safe HTML allowlist; preview |
| from_name | verified business identity | Tenant/mailbox | Sender verification enforced |
| reply_to | verified email | Tenant/mailbox | Domain/address validation |
| notifications | per-event channels | User | Email/in-app/digest toggles |
| digest_frequency | daily/weekly/none | User | Sends at local preference time |
| quiet_hours | `[start,end,tz]` | User/tenant | DST-aware; inbound not blocked |
| business_hours | weekdays and windows | Tenant/campaign | DST-aware and holiday-aware |
| holidays | calendar references | Tenant | Import/override support |
| default_meeting_length | minutes | User/tenant | 15/30/45/60 with policy range |
| meeting_buffer | minutes | User | Prevent overlapping bookings |
| AI_default_tone | Enum + approved custom | Tenant/product | Versioned prompt settings |
| AI_signature_disclosure | template | Tenant | Must not misrepresent automated identity |
| daily_send_cap | integer | Tenant/channel | Cannot exceed provider/policy ceiling |
| retention_profile | policy ID | Tenant | Compliance admin restricted |

**Preference changes:** optimistic concurrency via `version`; audit old/new nonsecret settings; re-render previews; timezone changes must not mutate stored UTC scheduled instants unless user explicitly reschedules.

## 5. THIRD-PARTY CONNECTOR FRAMEWORK (PROVIDER-AGNOSTIC)

The application must accept an extensible *schema-driven* set of properties for each installed connector, rather than a giant form with hardcoded Gmail/WhatsApp-only inputs. Each provider publishes a versioned manifest; the tenant config contains values validated against that manifest. Administrators can add all supported provider fields, including provider-specific `advancedProperties` in a defined namespace, but cannot introduce arbitrary executable code or unknown secret keys.

### 5.1 Generic connector object

```json
{
  "key": "whatsapp_cloud",
  "manifestVersion": "1.0.0",
  "category": "messaging",
  "capabilities": ["inbound_messages", "outbound_messages", "templates", "delivery_receipts"],
  "auth": {"type": "secret_reference", "secretRef": "vault://tenant/connector/wa/token"},
  "providerConfig": {"wabaId": "...", "phoneNumberId": "...", "graphApiVersion": "version-approved-by-adapter"},
  "webhooks": {"enabled": true, "verifyTokenSecretRef": "vault://...", "signatureSecretRef": "vault://..."},
  "mapping": {"externalContactId": "contact.external_id"},
  "limits": {"maxPerMinute": 20, "retryPolicy": "exponential"},
  "health": {"status": "unverified", "lastCheckedAt": null},
  "enabled": false
}
```

### 5.2 Required connector settings groups

| Group | Property examples | Validation / controls |
|---|---|---|
| Identity | display name, provider, category, tenant scope, environment | Stable provider IDs; tenant-scoped |
| Authentication | OAuth authorize/token URLs, client ID, client secret ref, scopes, API key ref, token expiry | Credential encryption, restricted hosts, rotation, scopes preview |
| Connection | base URL, API version, region, proxy policy, TLS certificate validation | URL allowlist; SSRF protection; TLS mandatory |
| Webhooks | callback URL, event subscriptions, signature scheme, verification tokens, replay window | HMAC/signature verification; idempotency |
| Data mapping | objects, fields, direction, transforms, conflicts, null handling | Type checking, sample dry run |
| Scheduling | poll interval, sync cursor, batching, time windows | Rate and provider quota controls |
| Reliability | retries, backoff, timeout, circuit breaker, dead-letter behavior | No duplicate external side effects |
| Governance | consent requirements, data classification, retention, country rules | Server-side policy enforcement |
| Observability | logs, health, error categories, quota usage, delivery receipts | Mask secrets and PII |
| Extension | provider namespaced JSON Schema fields | Schema-validated and versioned only |

**Connector state machine:** `DRAFT -> AUTHORIZING -> CONNECTED -> DEGRADED -> DISCONNECTED`, with `TESTING`, `EXPIRED`, `REVOKED` and `ERROR` substates. Tokens and webhook secrets must be rotatable with no downtime where supported. A failed test cannot mark the integration connected.

**Initial providers:** generic SMTP/IMAP and supported OAuth email (Google/Microsoft), Google/Microsoft calendar, Meta WhatsApp Business Platform, webhooks, CSV import, one permitted research adapter. HubSpot/Salesforce/Pipedrive/Slack/Teams/Zoom and other connectors are extension targets, not claims of functioning integrations in MVP.

## 6. WHATSAPP BUSINESS AUTOMATION AND AI BOT

**Access model:** use the official WhatsApp Business Platform / Cloud API or an authorized provider, with properly owned or permitted WhatsApp Business Account (WABA), phone number, app permissions, required business verification where applicable, access token, callback verification, configured webhook subscriptions and appropriate messaging templates. Pricing and conversation/template rules are provider-controlled and can change; read current official terms during implementation and release.

**WhatsApp setup UI fields:** provider and environment; business portfolio ID; WABA ID; phone number ID; verified display name; callback URL; verification-token secret reference; signing/app-secret reference; access token/credential reference; Graph API version; token expiry/status; subscribed webhook events; subscribed message statuses; message window indicator; approved template catalog; template locale/category/variables; media policy; recipient consent source/purpose/timestamp; sending limits; business hours; fallback support agent/team; response tone/language; LLM/provider/model; model cost/token cap; human takeover; handoff SLA; restricted topics; stop words/opt-outs; do-not-contact list; message retention; testing recipient; last health check and error status.

### 6.1 Incoming message pipeline

`Verified webhook -> dedup external message ID -> tenant/phone binding -> normalized message/media -> consent and suppression checks -> conversation ownership check -> intent classifier -> knowledge retrieval -> action policy -> generated candidate -> groundedness/claims check -> send through provider -> store provider receipt -> update CRM/audit`.

### 6.2 Outbound template pipeline

`campaign request -> jurisdiction and consent policy -> audience verification -> provider-approved template + language -> variable validation -> permitted window check -> budget + limits -> approval (where required) -> send -> receipt webhook -> monitor delivery / opt-out`.

### 6.3 WhatsApp AI bot controls

| Control | Allowed settings | Enforcement |
|---|---|---|
| Bot operating mode | OFF / DRAFT / AUTONOMOUS-INBOUND / POLICY-CONTROLLED | Server tools verify mode before sending |
| Knowledge scope | Chosen product versions, FAQs, attachments | Tenant and publication-version scoped |
| Qualification | Configurable slots and scoring rules | Structured JSON state, no invented facts |
| Escalation | Pricing, legal advice, frustration, low confidence, VIP, explicit human request | Claim owner and pause AI outbound |
| Message frequency | Per contact/day, campaign, permitted session | Provider/channel + tenant policy minimum |
| Working hours | IANA timezone + weekdays + holidays | Only permitted sends; inbound monitored continuously |
| Consent | Purpose, source, timestamp, lawful basis policy | No marketing send without required permission |
| Media | MIME allowlist, size, antivirus scanning, expiry | Reject unsafe and oversize attachments |
| Language | Auto-detect with fallback and supported locales | Human review on unsupported language |
| Template use | Provider-approved status and variables | Reject unapproved or mismatched template |
| Logging | Delivery ID, policy verdict, response version | Never store tokens or unnecessary sensitive text in audits |

**Acceptance:** inbound messages are visible within an operational target of 30 seconds under normal conditions; webhook signature is verified; retries do not duplicate responses; opt-out halts marketing sends immediately; a conversation outside a permitted service window never sends an ordinary free-form business-initiated response; approved templates are used only when eligibility is satisfied; unsupported pricing/legal commitments route to human review. These are proposed targets, not provider guarantees.

## 7. AUTHORIZATION AND ROLE MODEL

Permissions are resource/action pairs with tenant scope and optional constraints (`own`, `team`, `all`). A role never grants access outside its tenant. Platform support access requires a documented just-in-time, time-bounded, customer-approved support session with complete audit.

| Permission family | Examples | Default allowed roles |
|---|---|---|
| org.* | org.read, org.update, domain.verify, billing.read | Owner/admin |
| identity.* | user.invite, user.disable, role.manage, sso.manage, session.revoke | Security admin / owner |
| connector.* | connector.read, connector.configure, connector.test, connector.rotate_secret | Integration admin / owner |
| campaign.* | campaign.create, campaign.launch, campaign.pause | Marketing manager / sales manager |
| lead.* | lead.read, lead.edit, lead.export, contact.suppress | Sales role per assigned scope |
| messaging.* | draft.create, message.approve, message.send, template.manage | Agent policy + sales manager |
| ai.* | agent.configure, model.select, agent.run, run.inspect, autonomy.change | AI admin / owner |
| meeting.* | meeting.book, transcript.read, notes.approve, recording.manage | Meeting owner / authorized manager |
| audit.* | audit.read, audit.export, security.policy.update | Security auditor/admin |
| data.* | data.export, data.erase, retention.manage | Privacy admin / owner |

**Separation of duties:** A person configuring a risky connector cannot automatically waive its security review; access to audit logs does not imply ability to alter logs; sales reps cannot change tenant authentication or data retention; AI agents cannot assign themselves new permissions. Custom roles may be created by tenant admin only within tenant policy ceilings.

## 8. PERSISTENCE AND SQL SCHEMA ADDENDUM

The schema below extends the existing `tenants`, `users`, `tenant_memberships`, `audit_events`, `integrations`, `conversations`, `messages`, `agent_runs` and `meetings` tables. UUID primary keys, tenant foreign keys, indexed creation times and row-level security should be applied consistently. Secret *values* never live in normal configuration JSON.

```sql
CREATE TABLE identity_providers (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id),
 protocol text NOT NULL CHECK (protocol IN ('oidc','saml')),
 name text NOT NULL, issuer text, metadata_url text,
 config jsonb NOT NULL DEFAULT '{}', secret_ref text,
 status text NOT NULL DEFAULT 'draft', verified_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,name)
);
CREATE TABLE user_sessions (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id),
 user_id uuid NOT NULL REFERENCES users(id), token_hash text NOT NULL UNIQUE,
 device_label text, user_agent_hash text, ip_prefix inet,
 created_at timestamptz NOT NULL DEFAULT now(), last_seen_at timestamptz,
 idle_expires_at timestamptz NOT NULL, absolute_expires_at timestamptz NOT NULL,
 revoked_at timestamptz, revocation_reason text
);
CREATE TABLE account_recovery_tokens (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id),
 token_hash text NOT NULL UNIQUE, purpose text NOT NULL,
 expires_at timestamptz NOT NULL, consumed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE preference_profiles (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id),
 user_id uuid REFERENCES users(id), values_json jsonb NOT NULL DEFAULT '{}',
 version integer NOT NULL DEFAULT 1, updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,user_id)
);
CREATE TABLE connector_manifests (
 id uuid PRIMARY KEY, provider_key text NOT NULL, manifest_version text NOT NULL,
 schema_json jsonb NOT NULL, capabilities jsonb NOT NULL,
 UNIQUE(provider_key,manifest_version)
);
CREATE TABLE connector_instances (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id),
 manifest_id uuid NOT NULL REFERENCES connector_manifests(id),
 display_name text NOT NULL, config_json jsonb NOT NULL DEFAULT '{}',
 secret_reference jsonb NOT NULL DEFAULT '{}', status text NOT NULL DEFAULT 'draft',
 created_by uuid REFERENCES users(id), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE connector_events (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id),
 connector_id uuid NOT NULL REFERENCES connector_instances(id),
 provider_event_id text, event_type text NOT NULL,
 received_at timestamptz NOT NULL DEFAULT now(), signature_valid boolean,
 processing_state text NOT NULL, failure_category text,
 UNIQUE(connector_id,provider_event_id)
);
CREATE TABLE whatsapp_channels (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id),
 connector_id uuid NOT NULL REFERENCES connector_instances(id),
 waba_id text NOT NULL, phone_number_id text NOT NULL,
 bot_mode text NOT NULL DEFAULT 'off',
 bot_settings jsonb NOT NULL DEFAULT '{}',
 UNIQUE(tenant_id,phone_number_id)
);
CREATE TABLE consent_records (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id),
 contact_id uuid NOT NULL, channel text NOT NULL, purpose text NOT NULL,
 status text NOT NULL, source text NOT NULL, evidence_ref text,
 recorded_at timestamptz NOT NULL, withdrawn_at timestamptz
);
CREATE TABLE access_audit_events (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id),
 actor_user_id uuid REFERENCES users(id), actor_agent_id uuid,
 event_type text NOT NULL, target_type text, target_id uuid,
 request_id text, ip_prefix inet, outcome text NOT NULL,
 sanitized_details jsonb NOT NULL DEFAULT '{}', occurred_at timestamptz NOT NULL DEFAULT now()
);
```

**Indexes/RLS requirements:** index `(tenant_id, occurred_at DESC)` audit, `(tenant_id,user_id,revoked_at)` sessions, `(tenant_id,status)` connector instances, `(tenant_id,phone_number_id)` channels; apply `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY` and tenant predicates to every customer table; use non-owner DB roles and transaction-scoped tenant context. Reject missing tenant context. RLS is defense in depth, not the only authorization check.

**Credentials:** use a secrets vault when available, or an application-level envelope-encrypted secrets store with restricted server-only access, rotation and backup keys. Do not put private client secrets, access tokens or webhook verify tokens into unencrypted JSON columns, browser localStorage or API responses.

## 9. API CONTRACT EXTENSIONS

All endpoints require tenant-aware authorization unless explicitly public (`/auth/*` and verified provider callbacks). JSON error structure: `{code,message,requestId,details?}`; secrets redacted. Write endpoints require CSRF controls for cookie-authenticated clients, version preconditions where applicable, and idempotency keys for external side effects.

| Method/path | Permission | Request/response contract |
|---|---|---|
| POST /v1/auth/login | public | `{email,password,remember}` -> session cookie + user summary |
| POST /v1/auth/forgot-password | public | `{email}` -> 202 generic confirmation |
| POST /v1/auth/reset-password | public | `{token,newPassword}` -> 204 and session revocation |
| GET /v1/auth/oidc/:provider/start | public | state/nonce/PKCE verified redirect |
| GET /v1/auth/oidc/:provider/callback | public | verified claims -> membership/session |
| POST /v1/auth/mfa/verify | session challenge | `{challengeId,code}` -> authenticated session |
| GET /v1/sessions | identity.session.read | sessions with masked metadata |
| DELETE /v1/sessions/:id | identity.session.revoke | 204 + audit |
| GET /v1/preferences | preference.read | resolved values + overrides/version |
| PATCH /v1/preferences | preference.update | `{changes,expectedVersion}` -> updated values |
| GET /v1/identity-providers | identity.sso.read | tenant provider list, no secret values |
| POST /v1/identity-providers | identity.sso.manage | validated provider config -> draft |
| POST /v1/identity-providers/:id/test | identity.sso.manage | verified test result, not auto-enable |
| GET /v1/connectors/manifests | connector.read | provider manifest catalog |
| POST /v1/connectors | connector.configure | `{manifestId,displayName,config,secretInputs}` -> instance with masked fields |
| PATCH /v1/connectors/:id | connector.configure | versioned schema-validated config update |
| POST /v1/connectors/:id/test | connector.test | asynchronous test job receipt |
| POST /v1/connectors/:id/rotate | connector.rotate_secret | rotation receipt; no secret value returned |
| GET /v1/connectors/:id/events | connector.read | paginated sanitized webhook/operation events |
| GET /v1/channels/whatsapp | channel.read | configured channels and health |
| PATCH /v1/channels/whatsapp/:id/bot | ai.agent.configure | mode, limits, knowledge, escalation with version |
| GET /v1/channels/whatsapp/:id/templates | messaging.template.read | provider-reported approvals and locales |
| POST /v1/channels/whatsapp/:id/test | channel.test | allowed test recipient and policy verdict |
| GET /v1/audit-events | audit.read | cursor pagination, filters, redacted metadata |
| POST /v1/audit-events/export | audit.export | async protected export with expiry |

**Webhook:** `GET /webhooks/meta/whatsapp` implements provider verification challenge; `POST /webhooks/meta/whatsapp` validates request signature over raw body, resolves known phone number IDs, deduplicates event IDs, responds promptly, enqueues processing and handles retries. Never accept tenant identity from unverified webhook body alone.

## 10. THREAT MODEL AND SECURITY CHECKLIST

| Threat | Mitigation | Acceptance test |
|---|---|---|
| Credential stuffing and account enumeration | Adaptive limits, non-disclosing errors, security monitoring | Same external recovery response for existing/nonexisting account |
| SSO assertion forgery/replay | Signed claims/assertions, issuer, audience, state/nonce, replay cache | Forged/replayed callback rejected |
| Tenant breakout / IDOR | Tenant context, object authorization, RLS, negative tests | Cross-tenant read/write always denied |
| CSRF / XSS | CSRF token or safe same-site strategy, CSP, HTML sanitization | Stored XSS and CSRF regression tests pass |
| Token/key leakage | Vault/secret refs, masked UI, encrypted backups, log redaction | Secret canary absent in API/log exports |
| SSRF via custom connector | Host allowlist, block private/link-local IP ranges, safe DNS/TLS | Access to metadata/internal services denied |
| Webhook forgery | Signature checks, timestamps/replay protection, idempotency | Invalid signatures return 4xx; duplicate no double send |
| Prompt injection from lead websites/WhatsApp | Treat inputs as untrusted, policy gate outside LLM, scoped tool tokens | Malicious text cannot invoke unauthorized send/export |
| Sending unauthorized marketing messages | Consent, policy, opt-out and template checks | Suppressed contacts never receive marketing sends |
| AI invented contract terms | Retrieval grounding, price policy, human approval | Unsupported discount/legal commitment blocked |
| Audit modification | Append-only writes, access restrictions, off-host copies as available | No API route permits alteration of past events |
| Misconfigured timezone/meeting | UTC storage and IANA conversions, DST tests | Correct scheduling across DST changes |

Security baseline: target OWASP ASVS 5.0 controls appropriate to the deployment, with particular emphasis on identity, session management, access control, logging and error handling. Complete a documented threat model and independent review before enabling unattended outbound automation for external tenants.

## 11. ACCEPTANCE TEST SUITE (REPRESENTATIVE, AUTOMATABLE)

| Test ID | Given | When | Then |
|---|---|---|---|
| AT-AU-01 | Unknown email address | Forgot password submitted | Public response is generic, timing approximately comparable; no account disclosure |
| AT-AU-02 | Valid unused reset token | Password reset twice | First succeeds; second rejected; old sessions invalid |
| AT-AU-03 | SSO callback with altered `state` | Callback processed | Login denied and security audit logged |
| AT-AU-04 | Valid user in tenant A | Requests tenant B config | 403/404, no data leakage |
| AT-AU-05 | User with revoked session | Calls API | 401, refresh denied |
| AT-PF-01 | `Asia/Kolkata` timezone | User views UTC event | Displays appropriate local time without changing UTC stored event |
| AT-PF-02 | Upcoming DST shift in US | Scheduler generates slots | Slots honor IANA timezone rules |
| AT-CN-01 | Connector missing mandatory property | Admin saves form | Field-level validation errors; no secret persisted |
| AT-CN-02 | API key secret configured | Admin reopens settings | Only masked state visible; never raw secret |
| AT-CN-03 | Invalid webhook signature | Event received | Rejected, audited, no agent run triggered |
| AT-CN-04 | Duplicate webhook provider ID | Event retried | Exactly one normalized event and side-effect job |
| AT-WA-01 | Customer opted out | Outreach agent schedules marketing template | Action blocked and reason logged |
| AT-WA-02 | No eligible WhatsApp send window | Agent drafts ordinary outbound text | Send blocked; policy-based approved template path considered only if eligible |
| AT-WA-03 | Prospect requests a human | AI bot receives request | AI outgoing stopped; sales owner notified |
| AT-WA-04 | Customer asks unsupported price | Bot generates price promise | Policy gate denies; price clarification escalated |
| AT-SEC-01 | Sales rep login | Accesses SSO secrets | Access denied; audit event logged |
| AT-SEC-02 | Admin changes role/retention | Configuration saved | Structured before/after metadata logged with sensitive values redacted |
| AT-SEC-03 | Secret-canary test string | API, job and audit events run | Canary absent from log exports |
| AT-UX-01 | Keyboard-only user | Navigates login and settings | Visible focus, labels and error messages accessible |
| AT-AI-01 | LLM creates unauthorized action proposal | Supervisor processes response | Policy-gated tool rejects external side effect |
| AT-AI-02 | Agent plans message sending | Provider returns failure | UI shows failed/retry, never sent/completed |

## 12. DESIGN SCREENSHOTS AND DESIGN-TO-BUILD NOTES

The package includes two multi-screen concept boards:

1. `screens/enterprise_auth_settings_board.png` — login, forgot password, reset password, MFA, SSO chooser, agent overview, agent execution, regional preferences, connector marketplace, WhatsApp AI bot and audit.
2. `screens/enterprise_integrations_whatsapp_board.png` — SSO settings, configuration panels, integrations, WhatsApp AI, agent settings, execution inspector, approvals, meeting notes, enterprise security and globals.

**UI evidence limitation:** These are AI-generated *conceptual screenshots*, with placeholder company identities, sample values and visually implied integrations. They are not actual browser screenshots, validated working provider connections, implementation proof or pixel-perfect specifications. The screen register, API contracts and tests above define the implementation behavior. Before engineering signoff, convert each visual into Figma/components and resolve text/content accuracy.

## 13. DELIVERY SPRINTS AND ONE-TIME BUDGET

| Sprint | Deliverables | Gate |
|---|---|---|
| 0 (week 1) | Threat model, screen map, tenant permission matrix, provider-manifest contract | Reviewed architecture and ownership |
| 1 (weeks 2–3) | Login/recovery/session/audit, preferences, secure connector vault abstraction | Authentication negative tests pass |
| 2 (weeks 4–5) | OIDC SSO starter, provider manifest forms, connector tests, integration logs | SSO and connector tests pass |
| 3 (weeks 6–7) | WhatsApp sandbox webhook, bot rules, inbox, template catalog mock/sync | Verified webhook and opt-out tests |
| 4 (weeks 8–9) | Human approvals, AI action policy, security center, responsive UX | E2E approved/blocked simulations pass |
| 5 (weeks 10–12) | Pilot hardening, backup/recovery, telemetry, docs, regression | Security review and acceptance sign-off |

These are sequencing estimates assuming dedicated capacity; they are not guaranteed build dates. Real SAML/SCIM, multiple production connectors, broad WhatsApp business rollout and enterprise certification should be budgeted separately after the initial MVP.

| One-time external budget line | INR ceiling |
|---|---:|
| Security design/independent review support | 20,000 |
| Test identity/mail/provider configurations | 10,000 |
| WhatsApp sandbox and compliant test messaging | 8,000 |
| AI inference / prompt evaluation | 10,000 |
| VPS backups, monitoring and secure storage | 12,000 |
| UX/accessibility validation and testing | 10,000 |
| Contingency / external API surprises | 30,000 |
| **TOTAL** | **100,000** |

**Budget assumptions:** existing salary cost, existing VPS, business mailbox subscription, bespoke enterprise SAML/SCIM integration engineering, certifications and long-term production WhatsApp charges are excluded. If budget is constrained, prioritize identity/session security, basic configurable preferences, secure provider connector framework and sandbox WhatsApp; do not launch external multi-tenant unattended sales without security verification.

## 14. IMPLEMENTATION REFERENCES (OFFICIAL MATERIAL TO VERIFY AGAIN AT DEPLOYMENT)

- OWASP ASVS 5.0: https://asvs.owasp.org/
- OWASP security logging: https://github.com/OWASP/ASVS/blob/master/5.0/en/0x25-V16-Security-Logging-and-Error-Handling.md
- Microsoft SAML vs OIDC implementation guidance: https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/saml-vs-oidc-decision-guide
- Meta WhatsApp Business Platform documentation: https://developers.facebook.com/docs/whatsapp/cloud-api/
- Meta WhatsApp business messaging policy: https://business.whatsapp.com/policy

**Definition of enterprise-ready:** all implemented features have functional, authorization, observability, privacy and recovery tests; independent threat/security review completed; no advertised integration is labeled "connected" without verified provider acknowledgment; customer data retained/processed under documented policies; and operations can monitor outages, recover backups and revoke credentials.
