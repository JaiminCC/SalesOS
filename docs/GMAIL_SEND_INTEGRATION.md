# Gmail send integration

## Scope

Read-only consent uses `https://www.googleapis.com/auth/gmail.readonly`.

Send consent is a different authorization URL and uses `https://www.googleapis.com/auth/gmail.send`. Starting a read-only connection does not add the send scope. `sendScopeGranted` accepts only that scope or the short name `gmail.send`.

`SEND_AUTHORIZED` is stored only when the token response includes that scope. `sending_enabled` stays false until `POST /api/v1/management/email-sending/mailbox` and the caller has `mailbox.send.manage`. That call returns 409 `SEND_SCOPE_REQUIRED` when the scope or capability is missing. It still does not set the deployment flag.

## Request

`POST https://gmail.googleapis.com/gmail/v1/users/me/messages/send` with a JSON body `{ raw, threadId }`. `raw` is base64url RFC 822. Headers are From, To, optional Cc and Bcc, Subject, MIME-Version, Content-Type text/plain, and optional In-Reply-To and References. The message is not HTML unless a later change adds a reviewed HTML part. Attachments are not encoded.

## Response

A successful JSON body may contain `id` and `threadId`. Those values are stored. They mean Gmail accepted the message, not that the recipient received it. A missing id stays null. The local RFC Message-ID is not treated as proof.

## Reconciliation

`reconcileGmail` calls `users.messages.get` with `format=metadata` when the worker is allowed to perform live provider HTTP and a provider message id exists. `SENT_ITEM_CONFIRMED` requires `labelIds` to include `SENT`. A 200 without that label is `DELIVERY_UNKNOWN`. Neither result is recipient delivery. Redirects are not followed. If the call fails, the state stays unresolved and nothing is sent again.

## Verification

Level 1 and level 2: unit tests with an injected fetch. Level 3 live read, level 4 live send-scope consent, and level 5 a real message are not done. No Google client is configured here.
