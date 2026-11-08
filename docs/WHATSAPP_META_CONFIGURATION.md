# WhatsApp Meta configuration

**Selected Graph version:** `v27.0`.

Meta's media and mark-as-read pages, as cited on 5 November 2026, show `v27.0`. The official changelog request timed out, so Sprint 10 does not guess a newer version. `META_GRAPH_API_VERSION` may be set only to `v22.0`, `v23.0`, `v24.0`, `v25.0`, `v26.0`, or `v27.0`. Any other value is `UNSAFE_API_VERSION` and the app readiness becomes `CONFIGURATION_INVALID`.

Environment values:

| Name | Scope | Meaning |
|---|---|---|
| `META_APP_ID` | deployment | Meta app id. Empty means `NOT_CONFIGURED`. |
| `META_APP_SECRET` | deployment | Signs webhook bodies. It is not a tenant token. |
| `META_WEBHOOK_VERIFY_TOKEN` | deployment | GET handshake token. |
| `META_GRAPH_API_VERSION` | deployment | Allowlisted version. Default `v27.0`. |
| `META_EMBEDDED_SIGNUP_CONFIG_ID` | deployment | Present means Embedded Signup is `AUTHORIZATION_REQUIRED`, not connected. |
| `SALESOS_LIVE_WHATSAPP_SEND_ENABLED` | deployment | Default `false`. Forced false in test and CI. It cannot enable a send in this sprint. |

Per-tenant tokens, when an administrator rotates one, are encrypted with `DATA_ENCRYPTION_KEY` and stored in `whatsapp_credentials`. Management responses return a hint, not the token.

A configured app is not a WABA. A saved phone is not a verified webhook. This workspace label is **LIVE META — NOT CONFIGURED**.
