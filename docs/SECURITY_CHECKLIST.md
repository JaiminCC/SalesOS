# SalesOS security checklist

**Status:** Controls to implement and verify. Nothing in this list was penetration-tested in the 4 November 2026 audit.  
**Date:** 4 November 2026  
**Use:** a control is done when its tests exist and pass. Checking the box in a review meeting is not a pass.

The prototype fails every control below on purpose: it is a local demo. Do not deploy it with real contacts, real passwords, or live connector secrets. The audit findings that motivate each control are in `docs/REPOSITORY_AUDIT.md`.

Severity is release impact if the control is missing when external sending is enabled.

---

## Identity

### S-01 Password storage and login

**Severity:** Critical. **Depends on:** T2.1.  
**Gap:** Any 8-character password signs in. Nothing is hashed. Remember-me is a `localStorage` flag.  
**Control:** Argon2id, rotating `HttpOnly` `Secure` session cookies, no tokens in `localStorage`, uniform errors for unknown user and bad password, rate limit and lockout.  
**Acceptance criteria:**

- Password hashes are not reversible and are not written to logs or audit payloads.
- Production refuses demo authentication.

**Tests:** T2.1 integration tests; log-snapshot unit test; production-config test in T2.7.

### S-02 MFA for privileged actions

**Severity:** High. **Depends on:** T2.2.  
**Gap:** Any six characters pass. Security-policy toggles do not affect login.  
**Control:** TOTP for Owner, Admin, connector managers, and anyone who can pause automation. Recovery codes hashed and single-use.  
**Acceptance criteria:** Privileged routes reject a session that has not completed MFA.  
**Tests:** T2.2 `MFA_REQUIRED` integration test.

### S-03 Session revocation

**Severity:** High. **Depends on:** T2.2.  
**Gap:** "Revoke" deletes a fake row.  
**Control:** Server `revoked_at` checked on every request. Sign-out-others keeps only the current session.  
**Acceptance criteria:** A revoked cookie receives 401 on the next call.  
**Tests:** T2.2 revocation integration test and Security Center E2E.

### S-04 Password reset

**Severity:** High. **Depends on:** T2.1.  
**Gap:** Reset preview changes nothing and has no token.  
**Control:** Single-use hashed token, expiry, identical response whether the account exists, no email content that confirms account existence beyond the agreed template.  
**Acceptance criteria:** Reuse of a token fails. The token column is a hash.  
**Tests:** T2.1 reset tests.

### S-05 SSO

**Severity:** High before any tenant enables SSO. Not required to block the internal password pilot. **Depends on:** T9.4, T9.5.  
**Gap:** SSO buttons skip the IdP and continue into the app.  
**Control:** OIDC authorization code with PKCE, state, and nonce. SAML signature, audience, and replay cache. Draft providers cannot create sessions. `sso_only` stays off until a provider is verified.  
**Acceptance criteria:** The current "Preview SSO continuation" path does not exist in API mode.  
**Tests:** T9.4 and T9.5 mock IdP tests.

---

## Tenant isolation

### S-06 Row-level security

**Severity:** Critical. **Depends on:** T1.5, T2.3.  
**Gap:** One browser store. Tenant dropdown changes a label.  
**Control:** `FORCE ROW LEVEL SECURITY` on every tenant table. `salesos_app` without `BYPASSRLS`. `set_config` only inside the transaction. Composite foreign keys include `tenant_id`.  
**Acceptance criteria:** Unscoped connection reads zero tenant rows. Tenant A cannot read tenant B by id (404 at the API, zero rows in SQL).  
**Tests:** T1.5 catalog and pool-leak tests; AT-01 repeated in T5.1, T4.1, T8.2.

### S-07 Worker and cache scope

**Severity:** Critical. **Depends on:** T4.4.  
**Gap:** No worker.  
**Control:** Job payloads carry ids. The worker reloads rows under tenant context. Redis keys are prefixed `tenant:{tenantId}:`. Object keys start with `tenant/{tenantId}/`.  
**Acceptance criteria:** A job forged with tenant A's id and tenant B's aggregate id does not load B's row.  
**Tests:** T4.4 isolation integration test; storage key unit test in T3.2.

### S-08 Exports and search

**Severity:** High. **Depends on:** T9.6, T8.4.  
**Gap:** Audit CSV is built from React state and can be edited in the browser before download.  
**Control:** Export jobs run under RLS. Aggregates and briefing queries are tenant-scoped.  
**Acceptance criteria:** Export and briefing fixtures contain no foreign tenant ids.  
**Tests:** T8.4 and T9.6.

---

## Authorization

### S-09 RBAC and assignment

**Severity:** Critical. **Depends on:** T2.4.  
**Gap:** Permission checkboxes are not read by the shell. `canEditRoles` is unused.  
**Control:** Default deny. Permission catalog on every route. Sales users limited to assigned records on top of RLS.  
**Acceptance criteria:** Each non-owner role fails at least one denied route in the matrix test.  
**Tests:** T2.4 matrix.

### S-10 Platform operator

**Severity:** High. **Depends on:** T2.4.  
**Gap:** None in the prototype, and easy to get wrong later.  
**Control:** No application screen lists another tenant's messages by default. Break-glass is not in the MVP UI.  
**Acceptance criteria:** Operator health endpoints return no message bodies.  
**Tests:** Contract test on `/health/ready` and any ops route added later: response schema has no content fields.

---

## Secrets and integrations

### S-11 Credential encryption

**Severity:** Critical. **Depends on:** T6.4, T1.7.  
**Gap:** Connector passwords become a placeholder in `localStorage`, and the advanced field can store arbitrary text.  
**Control:** AES-256-GCM envelope encryption, versioned key id, keys outside Postgres and Git. Write-only secret fields. Manifest secret names rejected in `config`.  
**Acceptance criteria:** GET integration and audit payloads have no secret. Database column is ciphertext.  
**Tests:** T6.4 snapshot and 422 tests; T4.1 redactor.

### S-12 Connection tests

**Severity:** Medium. **Depends on:** T6.4.  
**Gap:** Test buttons toast without a network call and still feel like a result.  
**Control:** Worker performs the test. Status stays `UNVERIFIED` until success. Errors returned to the UI are codes, not raw upstream bodies that may echo secrets.  
**Acceptance criteria:** A failed SMTP auth does not mark `CONNECTED` and does not return the password.  
**Tests:** T6.4 mock mailbox.

### S-13 SSRF

**Severity:** Critical. **Depends on:** T5.3, T9.1.  
**Gap:** Webhook URL check is `new URL` plus `https:` only. Research fetch does not exist yet.  
**Control:** Block loopback, link-local, and private ranges after DNS resolution, and re-check before connect. Apply to research fetch and outbound webhooks.  
**Acceptance criteria:** Metadata IP and localhost URLs fail at save and at delivery.  
**Tests:** T5.3 and T9.1 SSRF fixtures.

### S-14 Inbound provider webhooks

**Severity:** Critical. **Depends on:** T6.6, T9.3.  
**Gap:** No inbound endpoint.  
**Control:** Verify provider signatures. Dedupe `(tenant, provider, event id)`. Reject unsigned requests before parsing them into agent input.  
**Acceptance criteria:** Five replays create one message. A bad signature creates zero messages.  
**Tests:** T6.6 AT-06; WhatsApp verify in T9.3.

### S-15 Outbound webhook signatures

**Severity:** High. **Depends on:** T9.1.  
**Gap:** The UI describes HMAC and does not sign anything.  
**Control:** HMAC-SHA256, timestamp, unique delivery id, retries stored.  
**Acceptance criteria:** The mock receiver rejects a tampered body and an old timestamp.  
**Tests:** T9.1.

---

## AI and outreach safety

### S-16 Policy before side effects

**Severity:** Critical. **Depends on:** T4.2, T6.5.  
**Gap:** Approve and Send only edit local arrays.  
**Control:** `PolicyService` is pure and mandatory. Model `requiresApproval` cannot force allow. Dispatch rechecks suppression, cap, quiet hours, approval version, and kill switch.  
**Acceptance criteria:** AT-04, AT-05, AT-08, and AT-24 automated.  
**Tests:** T4.2 unit table; T6.5 race tests.

### S-17 Human takeover and opt-out

**Severity:** Critical. **Depends on:** T6.6, T5.5.  
**Gap:** Handoff sets a status string. Opt-out is a WhatsApp demo toggle.  
**Control:** Takeover is sticky. Opt-out writes suppression before drafting. Pending sends are blocked.  
**Acceptance criteria:** AT-09 and AT-10 pass.  
**Tests:** T6.6 and T5.5.

### S-18 Untrusted content

**Severity:** Critical. **Depends on:** T4.3, T5.3, T8.3.  
**Gap:** No model. WhatsApp replies are keyword branches, which is safe only because they never send.  
**Control:** Pages, email, and transcripts are data. Tools are typed executors. One schema-repair retry, then escalate. No shell or SQL from model text.  
**Acceptance criteria:** Injection fixtures in research and transcripts create no export and no send.  
**Tests:** T5.3, T8.3, T4.3.

### S-19 No fabricated provider success

**Severity:** Critical. **Depends on:** T6.5, T7.2, T8.2.  
**Gap:** Toasts and runs say completed without a provider. Meeting checkboxes do not even persist.  
**Control:** `SENT` requires a provider message id or an explicit ambiguous state. `CONFIRMED` meetings require `provider_event_id`. Notes require an artifact.  
**Acceptance criteria:** AT-07, AT-11, AT-12, AT-21 pass. UI copy matches those states.  
**Tests:** Phase 6–8 tests named on those ATs; Playwright assertion that the sent bubble waits for status.

### S-20 Kill switch

**Severity:** Critical. **Depends on:** T4.4.  
**Gap:** Supervisor pause is a boolean that only blocks the local "Run AI cycle" toast path.  
**Control:** Tenant `automation_status` checked in the executor transaction. Resume re-runs policy.  
**Acceptance criteria:** A send queued before pause does not leave the process after pause.  
**Tests:** T4.4 pause integration test.

### S-21 Budgets

**Severity:** Medium. **Depends on:** T4.3.  
**Gap:** Model select is a label.  
**Control:** Record tokens and cost. Stop new model calls at the tenant cap. Human screens keep working.  
**Acceptance criteria:** AT-13.  
**Tests:** T4.3 budget unit test.

### S-22 Grounded claims

**Severity:** High. **Depends on:** T3.2, T6.2, T8.3.  
**Gap:** Pitches are string templates over seed data.  
**Control:** Drafts and notes cite approved facts or transcript segments. Missing citations are not sendable or are `NEEDS_REVIEW`.  
**Acceptance criteria:** ST-002, AT-04, AT-22, AT-23.  
**Tests:** T3.2, T6.2 eval set, T8.3 fixtures.

---

## Data protection

### S-23 PII columns

**Severity:** High. **Depends on:** T5.1, T8.2.  
**Gap:** Names, emails, and threads sit in `localStorage` in clear text.  
**Control:** Contact emails and message/transcript bodies are ciphertext. Dedup uses HMAC.  
**Acceptance criteria:** A SQL select of `contacts` and `messages` by a reviewer shows bytea, not RFC822 text.  
**Tests:** T5.1 and T8.2 schema assertions.

### S-24 Retention and deletion

**Severity:** High. **Depends on:** T9.6.  
**Gap:** Reset demo clears `localStorage` only.  
**Control:** Documented retention defaults. Deletion workflow audited. Suppression hashes retained. Derivatives enqueued.  
**Acceptance criteria:** AT-15 and AT-26.  
**Tests:** T9.6.

### S-25 Audit immutability

**Severity:** High. **Depends on:** T2.5.  
**Gap:** The client prepends and could alter audit objects. CSV export trusts that array.  
**Control:** Insert and select grants only for `salesos_app`. Payloads redacted.  
**Acceptance criteria:** Update and delete as the app role fail.  
**Tests:** T2.5 SQL privilege test.

---

## Application and supply chain

### S-26 Transport and browser

**Severity:** High before a public host. **Depends on:** T1.7, T9.7.  
**Gap:** `next dev` and `next start` bind `0.0.0.0`. No security headers.  
**Control:** TLS at the reverse proxy, HSTS, cookie flags, CSRF on cookie mutations, CORS allowlist, CSP that fits the existing UI. Postgres and Redis stay off the public interface.  
**Acceptance criteria:** Staging compose matches the architecture network split. A CSRF-missing mutation is rejected.  
**Tests:** T9.7 staging review; API test that a cookie mutation without the CSRF token returns 403.

### S-27 Dependency advisory open at audit time

**Severity:** High in the advisory database; exposure in this UI is limited because the app does not compile attacker CSS. **Depends on:** T1.8.  
**Gap:** `npm audit` on 4 November 2026 reported nested `postcss@8.4.31` inside `next@15.5.29` (high, `postcss <=8.5.22`) and a moderate advisory on `next` because of that dependency. Direct `postcss@8.5.32` is outside that range. `npm audit fix --force` would move to Next 16 and was not applied.  
**Control:** Track the advisory. Upgrade Next when a 15.x or accepted 16.x release no longer vendors the affected PostCSS, or record a dated exception that names the GHSA ids. Re-review the exception at each release.  
**Acceptance criteria:** CI fails on new high advisories that are not listed in the exception file.  
**Tests:** T1.8.

### S-28 File upload

**Severity:** High. **Depends on:** T3.2, T8.2.  
**Gap:** No uploads.  
**Control:** Size cap, allowlisted types, malware-scan hook, storage outside the web root, checksum verified.  
**Acceptance criteria:** Oversize and wrong MIME rejected. Hash mismatch does not become `TRANSCRIPT_READY`.  
**Tests:** T3.2 and T8.2.

### S-29 Logging

**Severity:** High. **Depends on:** T4.1, T4.3.  
**Gap:** None beyond browser toasts.  
**Control:** Structured logs with trace and tenant id. No bodies, transcripts, passwords, or tokens at info level.  
**Acceptance criteria:** A test logger fixture of a send job contains the run id and not the message body.  
**Tests:** T4.1 redactor test extended to the log formatter.

---

## Pilot gate

These must be true before the first real mailbox sends to people outside the engineering team. They map to T9.7 and BRD §21.1.

| # | Gate | Proving test |
|---|---|---|
| G-1 | Two-tenant negative suite green, including runs, knowledge, transcripts, and exports | T1.5, T2.3, T3.2, T4.1, T8.2, T9.6 |
| G-2 | Opt-out beats a queued send | T6.5 AT-05 |
| G-3 | Kill switch beats a queued send | T4.4 |
| G-4 | No send without approval in the MVP approval mode | T6.2, T6.5 |
| G-5 | Booking and notes cannot claim success without provider id or artifact | T7.2, T8.2 |
| G-6 | Backup restore rehearsed | T9.7 |
| G-7 | SPF, DKIM, and DMARC confirmed for the sending domain by the tenant operator | Operational record, not a unit test |
| G-8 | Counsel review for the markets and channel actually used | Signed note. This checklist is not legal advice. |
| G-9 | Demo authentication unreachable in the pilot environment | T2.7 |
| G-10 | Open high advisories either fixed or explicitly excepted | T1.8 |

WhatsApp (T9.3) adds G-1 through G-5 for that channel plus opt-in and template-approval checks before any business-initiated message. It is not a substitute for the email gates and not a prerequisite for the internal email pilot.
