# External discovery readiness

**Status: EXTERNAL DISCOVERY — NOT CONFIGURED.**

Implemented sources:

| Id | Label | Live |
|---|---|---|
| `manual` | USER PROVIDED DATA | false |
| `test` | LOCAL TEST DATA | false |

`externalDiscoveryStatus()` returns `{ id: 'external', configured: false, status: 'NOT_CONFIGURED' }`. `externalDiscoveryAdapter()` adds the unconfigured contract: `credentialStorage: encrypted`, required provenance, pagination, cancellation, retry state `FAILED_RETRYABLE`, and restrictions `NO_LICENSED_PROVIDER`, `NO_SCRAPING`, and `NO_INVENTED_RESULTS`. Rate limit and usage quota are null until a provider is configured. The discovery screen shows `EXTERNAL DISCOVERY — NOT CONFIGURED`. Neither implemented source is a live third-party search. The test source returns one fixed Northwind Logistics record and ignores the caller's company list.

No licensed provider credential is stored. This sprint did not create an account, call a paid API, or invent discovery results.

To add a provider later:

1. Choose a source the organization is licensed to query.
2. Store the credential with the existing model-credential encryption, or a new tenant-scoped secret column. Do not put the secret in the repository.
3. Add a provider id, version, rate limit, retry policy, and page size to a tenant configuration row.
4. Validate the query before the HTTP call. Allow only `https` endpoints from that configuration. Reject loopback, link-local, and private addresses for a remote provider.
5. Map each returned company to a discovery candidate with `providerId`, `providerMode`, source URL, and `live: true` only when the HTTP response was the provider's own payload.
6. Keep pagination, cancellation, and partial failure on the existing `crm_discovery_jobs` status fields.
7. Count usage against the tenant quota before the next page.
8. Prove the path with one authorized response that contains the provider's source identifiers. Until that response is stored, leave the status `NOT_CONFIGURED`.

Manual import and the labeled test directory stay available without that provider.
