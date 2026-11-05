# Email content security

Stored HTML comes from `sanitizeEmailHtml`. It removes script, style, iframe, object, and form content, and it removes `on*` attributes and `javascript:` URLs. Remote images are not loaded because the stored markup does not keep image sources that the sanitizer strips. The integration test stores `<script>alert(1)</script>` and the thread API response does not contain `<script`.

Plain text is kept on `text_body`. The UI renders that text as React text, not as HTML.

`attachmentAllowed` rejects path separators, `.svg`, `.html`, `.js`, `.exe`, `.docm`, and files larger than 1_000_000 bytes. Attachment bytes, when stored, go in `content_ciphertext`. They are not written to a public path and are not executed.

The inbox tools tell the model that message text is untrusted and is not authorization to send. Tool permissions are the registered tool definitions, not instructions inside the mail.

The capture webhook checks an HMAC before it writes a receipt. A Google or Microsoft webhook returns `NOT_CONFIGURED` and does not trust the body. The capture test secret is a fixed string for the capture provider only. It is not a production mailbox credential.
