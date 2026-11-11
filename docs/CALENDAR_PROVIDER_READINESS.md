# Calendar provider readiness

Providers are `GOOGLE_CALENDAR` and `MICROSOFT_CALENDAR`. Readiness is one of `NOT_CONFIGURED`, `CONFIGURATION_INVALID`, `CONFIGURED_UNVERIFIED`, `AUTHORIZATION_REQUIRED`, `CONNECTED_UNVERIFIED`, `READ_ACCESS_VERIFIED`, `SCOPE_MISSING`, `TOKEN_EXPIRED`, `REAUTH_REQUIRED`, `DEGRADED`, and `DISCONNECTED`.

Application credentials, a connected account, a successful read, and external write authorization are separate. This workspace has no calendar OAuth client, so create returns `NOT_CONFIGURED`. Disconnect increments `revocation_version` and sets `DISCONNECTED`. A granted write scope would not change `write_enabled`, which the database forces false.

Current labels: LIVE GOOGLE CALENDAR — NOT CONFIGURED. LIVE MICROSOFT CALENDAR — NOT CONFIGURED. REAL FREE/BUSY — NOT TESTED. EXTERNAL EVENT CREATION — NOT AUTHORIZED. CALENDAR INVITATIONS — NOT AUTHORIZED.
