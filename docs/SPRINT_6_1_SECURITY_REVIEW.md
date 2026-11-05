# Sprint 6.1 security review

Reviewed against the capture webhook, provider read path, sync worker, and inbox analysis.

## Capture webhook

The fixed string `capture-test-secret` is gone from the authorization path. Enablement requires an explicit development flag and a secret of at least 32 characters. Production boot refuses the flag. HMAC covers the raw body and uses a constant-time compare. Replay, oversize bodies, and a per-connection rate limit are rejected. Tenant scope comes from `lookup_capture_connection`, which is `SECURITY DEFINER`, `search_path = pg_catalog`, owned by `salesos_directory`, and limited to capture connections. The caller tenant id is ignored. Receipts are `RECORDED` and `sent: false`.

## Provider read

Requested scopes stay `gmail.readonly` and Microsoft `Mail.Read` plus the identity scopes already used for the mailbox address. A stored send scope stops sync. Graph delta URLs must use `https://graph.microsoft.com` before `fetch`. Token refresh and message reads run outside the database transaction. Tokens stay encrypted. API responses still omit them. Cursor updates are in the same transaction as the inserted messages. Rate-limit and read failures leave the cursor unchanged.

## Inbox analysis

Message text is loaded as untrusted facts. The system prompt tells the model not to follow instructions in the email, not to change permissions or tenant scope, and not to send. Inbox tools are `external: false`. `inbox.crm.context.read` returns `createdLead: false` and `consentFromEmail: false`. The local acceptance run stored a draft and created neither a lead nor a send attempt after an injected instruction to do both.

## Still open

No production penetration test was run. Live Gmail and Microsoft mailboxes were not connected. Live sending remains unimplemented. `evaluateSendGate` still cannot return a live allow.
