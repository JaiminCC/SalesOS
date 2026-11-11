# Calendar OAuth security

Google and Microsoft calendar authorization are separate from mailbox send scopes. The start route stores a SHA-256 state hash, an encrypted PKCE verifier, the exact redirect URI, the tenant, the actor, and a ten-minute expiry. The callback consumes the state once. A replay, a different redirect, a different actor, or an expired state returns `OAUTH_STATE_REJECTED`.

Sprint 11 does not exchange the authorization code and does not store a token. The connection remains `AUTHORIZATION_REQUIRED` or `NOT_CONFIGURED`. Management responses include `token: null`. A missing client id is `NOT_CONFIGURED`. A partial client is `CONFIGURATION_INVALID`. The callback does not mark `READ_ACCESS_VERIFIED`.
