# Mailbox provider readiness

`providerReadiness` inspects the API environment and returns a value per provider.

| State | Condition |
|---|---|
| `NOT_CONFIGURED` | Client id and client secret are both absent. |
| `CONFIGURATION_INVALID` | Only one value is set, or the secret is shorter than 8 characters. |
| `CONFIGURED_UNVERIFIED` | Both values are present. No mailbox has been proven. |

Required names are `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `MICROSOFT_OAUTH_CLIENT_ID`, and `MICROSOFT_OAUTH_CLIENT_SECRET`. The API returns the state. It does not return the secret.

Setup when the values are absent:

1. Register the OAuth client in Google Cloud or Microsoft Entra yourself. This repository does not create that registration.
2. Put the client id and secret in the API environment. Do not commit them.
3. Set the provider redirect URI to the exact inbox URL on an origin listed in `WEB_ORIGIN`.
4. Request `https://www.googleapis.com/auth/gmail.readonly` or Microsoft delegated `Mail.Read` plus the identity and refresh scopes already used by the read-only authorize URL. Do not request `gmail.send` or `Mail.Send` for this check.
5. Connect one consented test mailbox and run a bounded read. Only that path can become `LIVE_READ_VERIFIED`.

`CONFIGURED_UNVERIFIED` does not mean a mailbox is connected, and a token exchange does not mean messages were synchronized.
