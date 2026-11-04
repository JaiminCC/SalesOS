# RBAC permission matrix

New organizations receive five system roles. The API checks the signed-in session's permissions. Hiding a control in the browser does not grant the API call.

An actor who is not an owner can assign a role only when every permission of that role is already held by the actor. Owner transfer requires the current owner role and the current password. The previous owner becomes `ADMIN`, and the last owner cannot be removed.

Legacy seed roles `Owner`, `Admin`, `Manager`, `Sales`, `Analyst`, and `Reviewer` remain so existing demo rows keep their previous grants. `Owner` and `OWNER` both count as owner for transfer and suspension checks.

| Permission | OWNER | ADMIN | SALES_MANAGER | SALES_AGENT | VIEWER |
| --- | --- | --- | --- | --- | --- |
| organizations.manage | yes | yes | | | |
| users.invite | yes | yes | | | |
| users.manage | yes | yes | | | |
| roles.manage | yes | yes | | | |
| products.read | yes | yes | yes | yes | yes |
| products.write | yes | yes | yes | | |
| leads.read | yes | yes | yes | yes | yes |
| leads.write | yes | yes | yes | yes | |
| campaigns.manage | yes | yes | yes | | |
| conversations.read | yes | yes | yes | yes | yes |
| conversations.reply | yes | yes | yes | yes | |
| agents.read | yes | yes | yes | yes | yes |
| agents.manage | yes | yes | | | |
| integrations.manage | yes | yes | | | |
| meetings.manage | yes | yes | yes | yes | |
| approvals.manage | yes | yes | yes | | |
| audit.read | yes | yes | yes | | yes |
| settings.manage | yes | yes | | | |
| tenant.export | yes | | | | |

`ADMIN` also keeps the older catalog entries except `tenant.export`. Those older names are `outreach.send_approved`, `approvals.review`, `agents.configure`, `connectors.manage`, `products.publish`, `automation.pause`, and `meetings.book`.

Server guards:

- `SessionGuard` loads the cookie and rejects a missing, revoked, idle, or absolutely expired session.
- `PermissionGuard` requires the declared permission on the active organization.
- Organization mutations also require `sessions.active_tenant_id` to equal the path id.
