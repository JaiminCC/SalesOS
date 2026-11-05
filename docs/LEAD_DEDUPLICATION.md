# Lead deduplication

Exact account matching uses the normalized domain. Normalization strips the scheme, a leading `www.`, the path, and the query, and requires a dot in the name. The active-domain unique index stops a second active company with the same domain. Import policy `skip` links the row to the existing company.

A second match, legal name plus country with different domains, creates an `OPEN` duplicate candidate with confidence `0.70` and reason `Normalized legal name and country`. Similar names without a country do not create a candidate. Contacts match on the email HMAC. The import does not create a second contact with the same HMAC.

`duplicates/merge` is a human action. It requires `crm.leads.merge`. The kept account is the left id. Evidence and active suppressions that pointed at the right account are repointed. The right account is archived with lifecycle `MERGED`. Leads, qualifications, assignments, and takeovers are not deleted. A merge cannot see another tenant's pair because both the read and the update run inside `withTenant`.
