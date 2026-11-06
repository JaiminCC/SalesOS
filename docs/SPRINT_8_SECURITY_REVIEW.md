# Sprint 8 security review

Reviewed against the operational changes. No live provider was contacted and live sending was not enabled.

| Control | Result |
|---|---|
| New tenant tables | Forced row-level security, `tenant_isolation`, grants to `salesos_app` and `salesos_worker` only |
| Mailbox access | Overview, runs, errors, and alerts are filtered by `mailbox_access` |
| Metadata vs content | Operations responses do not include message bodies or tokens |
| OAuth | Read-only start still returns `NOT_CONFIGURED` without a client. Send scopes on a read connection stop sync and keep `sending_enabled` false |
| Redirects | Existing exact-origin check remains. Provider fetches still use `redirect: manual` |
| Graph links | HTTPS, `graph.microsoft.com`, port 443, no userinfo, path under `/v1.0/` |
| Cursor recovery | Refused unless the cursor is already expired. No provider call |
| Verification origin | Server-derived. Injected fetch is `STUB_TESTED`. A request field, a fixture, or configured-but-unused credentials cannot become `REAL_READ_VERIFIED` |
| Capture | Health `CAPTURE`. Not counted as healthy and not labeled live |
| Alerts | Tenant and mailbox scoped. Acknowledgement does not send or change delivery |
| Metrics | Provider and result code only |
| Sending | No new send route. `SALESOS_LIVE_EMAIL_SEND_ENABLED` is unchanged. No `SEND NOW` control |

No credential was generated or committed. Security-definer mailbox functions were not widened.
