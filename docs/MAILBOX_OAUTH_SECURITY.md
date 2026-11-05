# Mailbox OAuth security

Google and Microsoft use the authorization-code flow with PKCE. `oauthAuthorizeUrl` returns null when the client id is missing, and the API then returns `NOT_CONFIGURED` without writing a connection.

The state value is random. The database stores `sha256` of that value. The callback looks up the hash through `lookup_mailbox_oauth_state`, which is `SECURITY DEFINER`, owned by `salesos_directory`, and executable by `salesos_app`. A missing, consumed, or expired state redirects to `/workspace/inbox?mailbox=rejected`.

The redirect must match an origin in `WEB_ORIGIN` and the path `/workspace/inbox`. Any other target is `400 VALIDATION_ERROR`.

The code verifier is encrypted with `DATA_ENCRYPTION_KEY` before it is stored. The callback decrypts it only on the server. When the client secret is absent, the state is consumed and the browser is sent to `mailbox=not-configured`. No connection row is created.

When both the client id and client secret are present, `exchangeOAuthCode` posts to the provider token endpoint and then reads the mailbox profile. The access token and refresh token are encrypted and stored on `mailbox_connections`. `live` stays false and `sending_enabled` stays false. The granted scope stored for that row is `READ`. A failed exchange redirects to `mailbox=exchange-failed` and does not store tokens. The HTTP call is outside the database transaction.

The browser never receives a token. Logs and API responses do not include access tokens, refresh tokens, or authorization codes. The unit test uses a stub `fetch` and a fake token string that is not a real credential. Provider HTTP calls use `redirect: 'manual'` and refuse a 3xx response. Disconnect increments `revocation_version` so a token refresh that finishes after disconnect is not stored.

No Google or Microsoft application was registered for this workspace. Live provider sign-in was not tested. See `docs/REAL_MAILBOX_SYNC_VERIFICATION.md`.
