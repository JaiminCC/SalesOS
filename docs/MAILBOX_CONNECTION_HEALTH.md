# Mailbox connection health

Health is stored on the connection and in `mailbox_health_events`. It is not the provider configuration status and it is not the last live verification.

| Health | Meaning |
|---|---|
| `CAPTURE` | Local capture mailbox. Never live-provider healthy. |
| `HEALTHY` | A Google or Microsoft read finished with no next page. |
| `SYNC_DELAYED` | A page was stored and the provider still has another page. |
| `DEGRADED` | Sync is paused or the failure has no more specific class. |
| `RATE_LIMITED` | The provider returned HTTP 429. The cursor did not move. |
| `REAUTH_REQUIRED` | The access token or refresh token cannot be used. |
| `IDENTITY_MISMATCH` | The provider profile address does not match the stored mailbox. |
| `CURSOR_EXPIRED` | The saved history id or delta link was discarded after a recovery row was written. |
| `DISCONNECTED` | The connection was revoked. |
| `NOT_CONFIGURED` | No usable token is stored. |

Each transition stores the previous state, the next state, a reason code, the provider, the connection, a trace id, and operational counts. Tokens and message bodies are not stored in the event.
