# Sprint 5 security review

Reviewed against the CRM migration, `packages/shared/src/crm.ts`, `packages/database/src/crm-work.ts`, `apps/api/src/crm`, the worker dispatch, and the leads screen.

What holds:

- New tenant tables enable and force row-level security. `isolation.spec.ts` compares every `tenant_id` column with `TENANT_TABLES` and checks forced RLS.
- The API uses `salesos_app` through `withTenant`. The browser does not choose the organization id.
- Cross-tenant account read and search return no foreign row. The integration test covers that.
- Contact email and phone are encrypted with the existing AES-GCM field format. Suppression stores an HMAC. List payloads for suppression expose the hint, scope, and reason.
- CSV parsing rejects NUL bytes, caps rows and bytes, and neutralizes formula prefixes. It does not request remote resources.
- Duplicate ids in an archive batch return `400`.
- Sort fields are an allowlist. Filters are Prisma parameters, not concatenated SQL.
- Navigation tokens for CRM records are checked against the tenant and the matching permission. Paths stay `/workspace/leads/...` without a database id.
- Agent proposals tied to a lead fail closed when suppression or takeover is present, and they do not treat unknown consent as permission. The stored proposal outcome remains unsent.
- Discovery cannot be pointed at an unimplemented provider. Both implemented providers are labeled not live.

Limitations:

- Owner assignment trusts a user id from the caller because `salesos_app` cannot read `memberships`. A member with `crm.leads.assign` could store an id that is not a member. That does not cross tenants and does not grant the assignee a role.
- Lead research tools are registered, and a local result is explicitly unknown. They are not executed as a sourced research loop in the default supervisor plan.
- No live third-party discovery provider was reviewed because none is configured.
- This review does not certify compliance with privacy or marketing statutes. Retention of suppressions and archived CRM rows is intentional. The API does not offer hard delete for those records.

No outbound mailbox or WhatsApp code was added.
