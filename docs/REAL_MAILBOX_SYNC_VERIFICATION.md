# Real mailbox sync verification

**LIVE GMAIL — NOT TESTED.** **LIVE MICROSOFT — NOT TESTED.** **LIVE PROVIDER — NOT TESTED.**

Google OAuth client id and secret are absent. Microsoft OAuth client id and secret are absent. No provider account was created and no secret was read out of the environment for a live call.

## What was executed

Local HTTP stubs in `packages/integrations/src/provider-read.spec.ts` cover:

- Gmail list, message body, profile history id, refresh-token rotation, and HTTP 429.
- Expired Gmail history, HTTP 404, which returns the caller to list mode.
- Microsoft Graph delta messages, `conversationId` threading, and a delta link.
- A delta URL that is not `https://graph.microsoft.com` is not fetched.

`apps/worker/src/mailbox-recovery.spec.ts` kills the provider sync after the lease claim and before the HTTP read. The follow-up call is held. After the lease expires, one stubbed Gmail message is stored. A second sync does not insert a duplicate.

The API mailbox integration still imports capture mail, rejects a foreign redirect, and checks the capture webhook with an environment secret created for that test. A forged signature is rejected. A replay is rejected. A caller-supplied tenant id is not used as the authority. The receipt is `RECORDED` with `sent: false`.

## What a later live check needs

1. Register an OAuth client in Google Cloud or an app registration in Microsoft Entra. Use a test mailbox the organization has consented. Do not create that registration from this repository, and do not commit the client secret.
2. Set `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET`, or `MICROSOFT_OAUTH_CLIENT_ID` and `MICROSOFT_OAUTH_CLIENT_SECRET`, in the API environment.
3. Set the provider redirect URI to the inbox path on an origin listed in `WEB_ORIGIN`: `/workspace/inbox`.
4. Leave the requested scope at `gmail.readonly` or `Mail.Read`. Do not add `gmail.send` or `Mail.Send`.
5. Sign in, start the connect flow, and confirm the stored mailbox address matches the consented account.
6. Run one bounded sync. Record the stored message count, the cursor, and that `sending_enabled` and `live` stay false.
7. Run the sync again. The message count must not grow from duplicates, and the cursor may advance only after the rows exist.
8. Confirm an inbound reply joins the provider thread id or the RFC `In-Reply-To` header.
9. Confirm `mailbox_send_attempts` for that connection stays empty.

A stubbed HTTP response is not that check. This workspace has no client id or secret, so the live check was not run.
