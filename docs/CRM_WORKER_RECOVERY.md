# CRM worker recovery

`crm.import`, `crm.discovery`, and `crm.qualify` share `crm_work_leases`. A worker claims a lease for 30 seconds, commits each import row, discovery candidate, or qualification, and renews the lease between rows. The database transaction is not held across that boundary.

A second delivery while `lease_until` is still in the future returns without writing and the queue job throws `LEASE_HELD`, so BullMQ can retry. After the lease time has passed, the next worker claims it and continues. Import rows already marked `CREATED` or `SKIPPED` are not inserted again. Discovery inserts a company name only when that job does not already have it. Qualification stores one row per run id and does not insert another row once the lead score is set.

The job stops without writing further rows when:

- the import batch, discovery job, or qualify lease is `CANCELLED`, or the lead is archived
- `tenant_is_active` is false
- the creating member is no longer active or no longer holds `crm.leads.import`, `crm.leads.discover`, or `crm.leads.qualify`

Stopping for suspension or a missing permission releases the lease so an authorized run can continue later. Cancellation does not continue.

`apps/worker/src/crm-recovery.spec.ts` proves this with a separate process. `crm-crash.ts` is started with `node --import tsx`, prints `checkpoint` after the first committed row (or before the qualification insert), and is stopped with `SIGKILL`. The parent then checks the held lease, expires it, and runs the worker function again. Those tests are not in-process duplicate calls.

Product-research recovery stays in `apps/worker/src/recovery.spec.ts`.
