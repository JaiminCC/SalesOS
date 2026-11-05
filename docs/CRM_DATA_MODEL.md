# CRM data model

Tenant-owned CRM tables use composite keys `(tenant_id, id)` except `crm_contact_policies`, whose primary key is `tenant_id`, and link tables whose key is the pair of record ids. Forced row-level security uses `app.tenant_id`.

| Table | Role |
|---|---|
| `crm_accounts` | Company. Domain is unique while the row is active. Employee and revenue values carry a provenance status that defaults to `UNKNOWN`. |
| `crm_contacts` | Person at a company. Email and phone are ciphertext, HMAC, and a hint. Consent defaults to `UNKNOWN`. |
| `crm_leads` | Opportunity for one account and one optional product. Stage defaults to `NEW`. Eligibility defaults to `CONSENT_UNKNOWN`. |
| `crm_lead_contacts` | Extra contacts related to a lead. |
| `crm_stage_history` | From stage, to stage, reason, actor, time. |
| `crm_activities` | Short human or system notes. |
| `crm_assignments` | Owner history for an account, contact, or lead. |
| `crm_takeovers` | Active human control of communication. Distinct from assignment. |
| `crm_evidence` | A claim, its provenance (`VERIFIED`, `SOURCE_REPORTED`, `AI_INFERRED`, `UNKNOWN`), and a source reference. |
| `crm_qualifications` | One scored assessment. Includes scoring version, weights, dimensions, explanation, and optional model identity. |
| `crm_import_batches` / `crm_import_rows` | CSV batch, idempotency key, and row status. |
| `crm_duplicate_candidates` | A possible pair. Status stays `OPEN` until a person merges. |
| `crm_suppressions` | Active restriction. Removal sets `active` false. The row remains. |
| `crm_eligibility` | One recorded decision, its reasons, and the facts that were evaluated. |
| `crm_discovery_sources` | Provider registration for a tenant. |
| `crm_discovery_jobs` / `crm_discovery_candidates` | A bounded search and its raw candidates. |
| `crm_contact_policies` | One quiet-hours policy per organization. |

`revision` on accounts, contacts, leads, and import batches is the optimistic lock. A stale update returns `409 STALE_RECORD`. Stage changes use `canTransitionCrmLead`. Archive sets `archived_at` and, for a lead, requires a legal transition into `ARCHIVED`.
