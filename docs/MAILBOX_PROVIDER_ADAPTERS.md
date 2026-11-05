# Mailbox provider adapters

| Provider | Status | Read | Send | Draft | Watch / poll | Threading | Attachments |
|---|---|---|---|---|---|---|---|
| `capture` | `CAPTURE` | yes, user-supplied messages | no; capture records `sent: false` | yes | local cursor | RFC headers and provider thread id | metadata checked, unsafe types blocked |
| `google` | `NOT_CONFIGURED` without `GOOGLE_OAUTH_CLIENT_ID` | Gmail list, then history, page size 10, read-only | not implemented | stored locally | hourly incremental job | Gmail `threadId` | filename, type, and size only; body is not downloaded |
| `microsoft` | `NOT_CONFIGURED` without `MICROSOFT_OAUTH_CLIENT_ID` | Graph inbox delta, page size 10, `Mail.Read` | not implemented | stored locally | hourly incremental job | Graph `conversationId` | filename, type, and size only when Graph returns them |
| `imap` | `NOT_IMPLEMENTED` | declared only | no | no | declared only | declared only | no |
| `smtp` | `NOT_IMPLEMENTED` | no | declared only | no | no | no | no |

OAuth scopes requested by `oauthAuthorizeUrl` are `https://www.googleapis.com/auth/gmail.readonly` and Microsoft `offline_access User.Read Mail.Read`. Send scopes are not requested. A stored send scope stops sync with `SEND_SCOPE_PRESENT`.

Gmail and Graph requests stay on their HTTPS hosts. A redirect response is refused. A Graph delta link is fetched only when its host is `graph.microsoft.com`. `Retry-After` is recorded on HTTP 429 and the cursor stays where it was. The mailbox is not marked `SYNCED` for that attempt. An expired Gmail history id or Graph delta starts a fresh list or delta. When the provider profile includes an address and it differs from the stored mailbox address, the page is discarded and the connection records `IDENTITY_MISMATCH`.

Tests inject `fetch`. They do not call Google or Microsoft.

Level 3, an authorized live mailbox, was not tested. Level 4, a live send, is not configured and does not run.
