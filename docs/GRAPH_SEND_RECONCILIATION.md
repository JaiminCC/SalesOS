# Graph send reconciliation

Microsoft Graph `sendMail` can return HTTP 202 with no message id. SalesOS does not invent one.

The stubbed workflow is:

1. `POST /me/messages` with `Prefer: IdType="ImmutableId"`.
2. If the create response has no id, stop with `UNKNOWN` and do not send.
3. Persist that id, then `POST /me/messages/{id}/send` with the same preference.
4. HTTP 202 or another success status is `PROVIDER_ACCEPTED` with that id. It is not recipient delivery.
5. HTTP 401, 400, or 403 on send is `REJECTED`. The draft id is kept.
6. HTTP 404, 429, 5xx, or a thrown error after the draft id exists is `UNKNOWN`. The draft id is kept.
7. A thrown error before an id exists stays `UNKNOWN` with a null id.

Reconciliation sends nothing. `GET /me/messages/{id}?$select=id,isDraft` returns `SENT_ITEM_CONFIRMED` only when the body id equals the stored id and `isDraft` is false. `isDraft: true`, HTTP 404, a mismatched id, or a lookup error stays `DELIVERY_UNKNOWN`. Subject matching is not used. Sent Items are not treated as recipient delivery.

Microsoft documents immutable ids as stable across mailbox moves. This repository has not confirmed that a live tenant keeps the same id after send. If the id changes, lookup stays inconclusive and the attempt is not resent. Capability remains `STUB_TESTED`, never `LIVE_VERIFIED`.

Gmail reconciliation is separate. `GET` message metadata is `SENT_ITEM_CONFIRMED` only when `labelIds` includes `SENT`. A 200 without that label, a missing id, a timeout, or a revoked connection is `DELIVERY_UNKNOWN`. A Sent-label match is not proof the recipient received the message.
