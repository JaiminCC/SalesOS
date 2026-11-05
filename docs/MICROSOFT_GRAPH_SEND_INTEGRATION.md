# Microsoft Graph send integration

## Scope

Read-only consent uses `offline_access User.Read Mail.Read`.

Send consent uses `offline_access Mail.Send`. This is delegated send for the signed-in mailbox. Application permission to send as any user is not requested and not implemented.

`sendScopeGranted` accepts `Mail.Send` or a scope that ends with `/Mail.Send`. A read-only token does not pass.

## Request

The adapter does not call `sendMail`. It creates a draft, then sends that draft:

1. `POST https://graph.microsoft.com/v1.0/me/messages` with `Prefer: IdType="ImmutableId"`.
2. If the response has no id, stop with `UNKNOWN` and do not send.
3. `POST /me/messages/{id}/send` with the same preference.

The From address is not taken from the client. Graph sends as the token's mailbox. HTTP redirects are requested with `redirect: 'manual'` and a 3xx response is not followed.

## HTTP 202

202 after the draft id was stored is `PROVIDER_ACCEPTED` for that id. It is not recipient delivery. 202 does not invent an id. If create or send returns no id, `providerMessageId` stays null and the outcome is `UNKNOWN`.

A 404, 429, 5xx, or thrown error after the draft id exists is `UNKNOWN` and keeps that id. 401, 400, and 403 on send are `REJECTED` and keep the id. None of these are retried. Subject text is not used to find the message.

Immutable-id stability after send is stub tested. It has not been confirmed on a live tenant. If the id changes, lookup stays unresolved.

## Reconciliation

`GET /me/messages/{id}?$select=id,isDraft` is `SENT_ITEM_CONFIRMED` only when the body id matches and `isDraft` is false. A draft, a 404, a redirect, or a mismatched id stays `DELIVERY_UNKNOWN`. Sent Items are not searched by subject and are not recipient delivery. The worker does not send the draft version again.

## Verification

Stub tests cover draft creation, 202 with the stored id, 401, 429, 500, a dropped send, and lookup. No Microsoft tenant is connected. Live send is not authorized. The recorded capability is `STUB_TESTED`.
