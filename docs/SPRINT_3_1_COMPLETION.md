# Sprint 3.1 completion

Enterprise management screens, list behavior, dedicated add/view/edit pages, body-based management APIs, and session-bound navigation contexts are in place for the live modules. Simulated CRM, agent, and provider screens were not turned into live CRUD. Sprint 4 was not started.

## Completion matrix

PASS means the live behavior exists and the automated tests that cover it passed. DEFERRED means the screen is still simulated or the operation is intentionally absent. NOT APPLICABLE means that lifecycle does not exist for the resource. Simulated modules are not marked PASS.

| Module | List | Add | View | Edit | Delete / archive / revoke | Bulk | Search | Sort | Filter | Pagination | Permissions | Audit | Browser tests |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Members | PASS | PASS | PASS | PASS | PASS remove | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS |
| Organizations | PASS | PASS | PASS | PASS | PASS suspend/restore | NOT APPLICABLE | PASS | PASS | PASS | PASS | PASS | PASS | PASS create and switch |
| Roles | PASS | NOT APPLICABLE | PASS | NOT APPLICABLE | NOT APPLICABLE | NOT APPLICABLE | NOT APPLICABLE | NOT APPLICABLE | NOT APPLICABLE | NOT APPLICABLE | PASS | NOT APPLICABLE | PASS matrix |
| Invitations | PASS | PASS | PASS | NOT APPLICABLE | PASS revoke | PASS | NOT APPLICABLE | PASS | PASS | PASS | PASS | PASS | PASS send |
| Sessions | PASS | NOT APPLICABLE | PASS | NOT APPLICABLE | PASS revoke | PASS own sessions | NOT APPLICABLE | PASS | NOT APPLICABLE | PASS | PASS | PASS | PASS revoke |
| Audit | PASS | NOT APPLICABLE | PASS | NOT APPLICABLE | NOT APPLICABLE | NOT APPLICABLE | PASS | PASS | NOT APPLICABLE | PASS | PASS | NOT APPLICABLE | PASS heading |
| Products | PASS | PASS | PASS | PASS | PASS archive | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS |
| Versions | PASS | PASS | PASS | PASS draft | PASS workflow, no hard delete | NOT APPLICABLE | NOT APPLICABLE | PASS | PASS | PASS | PASS | PASS | PASS publish path |
| ICPs | PASS | PASS | PASS | PASS | PASS archive | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS create |
| Draft configuration | PASS | PASS | PASS | PASS | NOT APPLICABLE | NOT APPLICABLE | NOT APPLICABLE | NOT APPLICABLE | NOT APPLICABLE | NOT APPLICABLE | PASS | PASS | PASS positioning |
| Organization defaults | PASS | NOT APPLICABLE | PASS | PASS | NOT APPLICABLE | NOT APPLICABLE | NOT APPLICABLE | NOT APPLICABLE | NOT APPLICABLE | NOT APPLICABLE | PASS | PASS | DEFERRED |
| Knowledge | PASS | PASS | PASS | NOT APPLICABLE | PASS delete | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS upload, filter, confirmed delete |
| Command Center, agents, leads, campaigns, conversations, meetings, analytics | DEFERRED | DEFERRED | DEFERRED | DEFERRED | DEFERRED | DEFERRED | DEFERRED | DEFERRED | DEFERRED | DEFERRED | DEFERRED | DEFERRED | NOT APPLICABLE |
| SSO, integrations, WhatsApp, webhooks, preferences | DEFERRED | DEFERRED | DEFERRED | DEFERRED | DEFERRED | DEFERRED | DEFERRED | DEFERRED | DEFERRED | DEFERRED | DEFERRED | DEFERRED | NOT APPLICABLE |

## Acceptance criteria

| # | Criterion | Result |
| --- | --- | --- |
| 1 | Live modules use a consistent lifecycle | PASS |
| 2 | Live lists paginate, search, sort, and filter where those operations apply | PASS |
| 3 | Add, edit, and view use dedicated pages | PASS |
| 4 | Database ids are not in management URLs | PASS |
| 5 | Edit and view survive refresh | PASS |
| 6 | Two edit tabs keep their own records | PASS |
| 7 | Destructive actions confirm first | PASS |
| 8 | Supported bulk actions confirm first | PASS |
| 9 | Tenant isolation still enforced | PASS |
| 10 | RBAC and row-security tests pass | PASS |
| 11 | Mutations write audit events | PASS |
| 12 | Published versions stay immutable | PASS |
| 13 | Knowledge retention stays in place | PASS |
| 14 | Existing visual language stays | PASS |
| 15 | Playwright auth, product, and management specs pass | PASS |
| 16 | Lint, typecheck, unit tests, source check, and web build pass | PASS |
| 17 | The Sprint 3.1 documents exist | PASS |

## Limitations

- Exact member email search uses the email HMAC. Partial email search decrypts at most 100 memberships, ordered by user id, and reports `emailSearch.truncated` when the organization is larger. Name search stays complete. Invitation emails are still omitted from the invitation list.
- Login prefers the newest session's organization when that membership and organization are still active. Otherwise it chooses the lowest tenant id. Suspended organizations are skipped. The security regression still switches into the downgraded organization before it asserts permissions.
- The browser spec confirms bulk member removal, revokes a second session, and confirms knowledge deletion. The deleted document remains as a `DELETED` tombstone. Removed memberships stay as `REMOVED` rows, and the user accounts remain.
- Queries inside one Prisma interactive transaction are sequential. Concurrent `Promise.all` on that client mixed statement arguments and returned 500 on product list.
- Custom roles, organization bulk delete, and hard delete of published versions are intentionally absent.
- Simulated modules listed above have no production API.
