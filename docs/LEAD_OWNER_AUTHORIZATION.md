# Lead owner authorization

Assignment of a company, contact, or lead stores `owner_user_id` only after `public.member_is_assignable(tenant_id, user_id)` returns true.

The function is `SECURITY DEFINER`, owned by `salesos_directory`, with `search_path = pg_catalog`. It reads `users`, `memberships`, and `tenants` as that role. `salesos_app` and `salesos_worker` can execute it. They cannot `SELECT` `users`, and they cannot execute `list_user_memberships`. The function returns a boolean for the one tenant and one user it is given. It does not list other organizations.

The result is true only when all of these hold:

- The user row exists and `users.status` is `ACTIVE`.
- A membership exists for that user in the caller's tenant and `memberships.status` is `ACTIVE`.
- `tenants.status` is `ACTIVE`.

`INVITED`, `SUSPENDED`, and `REMOVED` memberships are not assignable. A user who belongs only to another organization is not assignable. An unknown id is not assignable. The API returns `404 NOT_ASSIGNABLE` for all of those cases.

The acting user must also hold the route permission: `crm.leads.assign` for leads, `crm.accounts.write` for companies, and `crm.contacts.write` for contacts. A viewer receives `403`.

The assignment transaction takes `pg_advisory_xact_lock(hashtextextended(tenant_id, 0))` and then `lock_member_for_assignment`. That function is `VOLATILE` and `SECURITY DEFINER`, owned by `salesos_directory`. It locks the tenant, user, and membership with `FOR UPDATE`, then calls `member_is_assignable`. Membership removal takes the same advisory lock before it changes the membership, so the two transactions cannot commit an owner for a member who is no longer active. Organization suspension takes the same advisory lock and also conflicts on the tenant row lock.

When a membership, user, or organization leaves `ACTIVE`, triggers call `end_member_ownership` or the tenant equivalent. Open assignment rows get `ended_at`. `owner_user_id` is cleared on the lead, account, and contact. The history row remains. `crm_takeovers` is not updated. Restoring a membership does not put the previous owner back.

Archived leads are not assignable. Bulk assignment uses the same owner check once for the batch. A missing or archived lead in the batch is a partial failure. The valid rows are still assigned. Clearing an owner (`ownerUserId` omitted) does not require a target user.

`crm_assignments` records the owner history. `crm_takeovers` is human communication control. Changing the owner does not set `active` false on a takeover.

Imports and discovery do not set an owner. A supervisor lead run does not set an owner.
