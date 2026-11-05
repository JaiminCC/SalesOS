# Lead discovery engine

Implemented providers:

| Id | Mode | What it returns | Live |
|---|---|---|---|
| `manual` | USER PROVIDED DATA | The companies in the request, at most 25 | `false` |
| `test` | LOCAL TEST DATA | Northwind Logistics, `northwind.example`, Logistics, US | `false` |

Any other provider id throws. The API reports `availability: LOCAL_ONLY`. The screen says the test directory is not a live external source.

A job moves `QUEUED` to `RUNNING` to `COMPLETED`, or to `CANCELLED` from `DRAFT`, `QUEUED`, or `RUNNING`. The worker and the API both call `runCrmDiscovery`. Each candidate commits on its own. A lease on `crm_work_leases` stops a second worker from inserting while the first lease is current. After the lease expires, the next run inserts only names that are not already stored. Each candidate stores `providerId`, `providerMode`, `live: false`, and an evidence object. If the domain already belongs to an active company, the candidate status is `DUPLICATE` and it keeps that account id. `discovery/promote` creates a company with verification `SOURCE_REPORTED`. It does not create a lead.

`externalDiscoveryAdapter()` describes the contract for a future licensed source: encrypted credentials, required provenance, pagination, a rate limit, a usage quota, cancellation, retry, and provider restrictions. Its `configured` and `live` values are false. The screen shows `EXTERNAL DISCOVERY — NOT CONFIGURED`.

The engine does not call LinkedIn, bypass access controls, guess email addresses, or fetch arbitrary URLs. No external discovery API was configured or verified in this sprint.
