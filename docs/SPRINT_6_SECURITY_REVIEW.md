# Sprint 6 security review

Reviewed against the mailbox tables, API, worker, and signed-in inbox.

Forced row-level security and `tenant_isolation` cover every new `mailbox_*` table. `salesos_app` and `salesos_worker` receive table grants. `mailbox_oauth_states` is also readable by `salesos_directory` for the lookup function. The lookup is `SECURITY DEFINER` with `search_path = pg_catalog`.

Mailbox visibility is `mailbox_access` for the current user, or the connecting user. Another member of the same organization receives 404. Another organization receives 404. The integration test checks both.

OAuth redirects are allowlisted. Tokens are encrypted. Responses omit them. The callback does not put tokens in the query string.

HTML is sanitized before it is stored. The script fixture does not come back. Attachment types that can run or render active content are rejected.

Draft approval is bound to the version digest. The author cannot approve. An edit revokes approval. Send time rechecks suppression, takeover, consent, verification, quiet hours, and organization state. Unknown facts block.

Email text cannot change tool permissions. Inbox tools are `external: false`.

The capture webhook no longer uses a fixed test string. Sprint 6.1 disables it unless a development flag and a long environment secret are both set, and production refuses that flag. See `docs/MAILBOX_CAPTURE_SECURITY.md`.

Live mailbox access and live delivery were not verified. No external send is enabled by the presence of OAuth or SMTP settings.

Cross-tenant denial, author separation, capture `sent: false`, and worker kill recovery were executed. A full production penetration test was not.
