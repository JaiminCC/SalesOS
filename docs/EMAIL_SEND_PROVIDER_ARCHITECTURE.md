# Email send provider architecture

`packages/integrations/src/email-send.ts` is the outbound adapter. The database package does not import it. `sendDraft` accepts an optional `deliver` callback. The API and the worker pass that callback only when `liveEmailSendEnabled(env)` is true.

## Capability labels

| Label | Meaning in this repository |
|---|---|
| `IMPLEMENTED` | Code exists. Not used as the recorded status, because the adapters have only been exercised with injected HTTP. |
| `STUB_TESTED` | The recorded status for Gmail send and Graph send. Stub success is not live verification. |
| `LIVE_VERIFIED` | Not claimed. No live mailbox is connected and no real message was sent. |
| `NOT_CONFIGURED` | Google or Microsoft OAuth client id is absent, or the deployment send flag is off. |
| `NOT_SUPPORTED` | Attachments. IMAP is not a sender. SMTP is not implemented. |

Capture, manual, and `test` are non-live. `test` exists so a database test can exercise the claim and the callback without calling Gmail or Graph.

## Operations that exist

- `sendWithGmail` posts RFC 822, base64url-encoded, to `gmail.users.messages.send`.
- `sendWithGraph` creates `/me/messages` with `Prefer: IdType="ImmutableId"`, stores the returned id, then posts `/me/messages/{id}/send`. It does not call `sendMail` and does not invent an id.
- `reconcileGmail` reads one message by the stored id. `SENT_ITEM_CONFIRMED` requires the `SENT` label. That is not `DELIVERY_CONFIRMED`.
- Provider HTTP uses `redirect: 'manual'`. A 3xx response is not followed and is not acceptance.
- Header values with CR or LF are rejected by `headerSafe` before the gate allows a send.
- The From address is the mailbox connection address. The adapter does not look up aliases.

## Operations that are not separate methods

Connection validation, scope validation, and error classification are split between `sendScopeGranted`, `evaluateSendGate`, and the HTTP status mapping inside `postJson`. There is no webhook receiver that marks a message delivered. A capture webhook still stores `sent: false`.

## Error classes

| HTTP or failure | Acceptance | Automatic retry |
|---|---|---|
| 400, 401, 403, 404 | `REJECTED` | No |
| 429, 5xx | `UNKNOWN` | No |
| Socket or thrown error after the attempt row exists | `UNKNOWN` | No |
| 3xx | `UNKNOWN`, redirect not followed | No |
| 200 with a Gmail id | `ACCEPTED` | No second dispatch of that draft version |
| Graph 202 after a stored draft id | `ACCEPTED` with that id, not recipient delivery | No |
| Graph 202 or success with no draft id | `UNKNOWN`, no invented id | No |

Gmail classification uses the 404 row above. A Graph send that returns 404 after a draft id exists is `UNKNOWN` and keeps that id, because the id may no longer match. Exact-once delivery is not claimed. The guarantee is at-most-once automatic dispatch after a request may have reached the provider.
