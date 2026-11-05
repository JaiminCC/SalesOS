# Sprint 5 implementation plan

This is the plan the Sprint 5 code follows. Signed-out demonstration screens stay simulated. Signed-in Lead Discovery uses PostgreSQL.

| Feature | Screen | API | Table | Worker | Permission | Test |
|---|---|---|---|---|---|---|
| Companies | LeadsDesk Companies | `POST /api/v1/management/accounts/*` | `crm_accounts` | none | `crm.accounts.read` / `write` | API integration, Playwright |
| Contacts | LeadsDesk Contacts | `contacts/*` | `crm_contacts` | none | `crm.contacts.read` / `write` | API integration |
| Leads and stages | LeadsDesk Leads | `leads/*` | `crm_leads`, `crm_stage_history` | none | `crm.leads.read` / `write` | API integration, shared stage graph |
| Summary | LeadsDesk header counts | `leads/summary` | aggregates | none | `crm.leads.read` | Playwright counts render from the API |
| CSV import | LeadsDesk Import | `lead-imports/*` | `crm_import_batches`, `crm_import_rows` | `crm.import` | `crm.leads.import` | API integration |
| Discovery | LeadsDesk Discovery | `discovery/*` | `crm_discovery_jobs`, `crm_discovery_candidates` | `crm.discovery` | `crm.leads.discover` | API integration, provider label |
| Qualification | Lead view | `qualification/run`, `qualification/override` | `crm_qualifications` | `crm.qualify` | `crm.leads.qualify` | API score 65 for the fixture ICP |
| Suppression | API and list | `suppression/*` | `crm_suppressions` | none | `crm.suppression.read` / `manage` | API eligibility `SUPPRESSED` |
| Human takeover | API | `ownership/takeover` | `crm_takeovers` | none | `crm.leads.assign` | API eligibility `HUMAN_OWNED` |
| Owner assignment | Lead view | `leads/assign` | `crm_assignments` | none | `crm.leads.assign` | Playwright |
| Eligibility | Lead view | `eligibility/evaluate` | `crm_eligibility` | none | `crm.leads.read` | API |
| Quiet hours | Contact windows | `contact-policies/*` | `crm_contact_policies` | none | `crm.contact_policy.manage` | shared `crm.spec.ts` |
| Duplicate review | Duplicates | `duplicates/list`, `duplicates/merge` | `crm_duplicate_candidates` | none | `crm.leads.merge` | name-and-country flag during import |
| Tenant isolation | all | session tenant | all CRM tables | worker role | RLS | `isolation.spec.ts`, cross-tenant 404 |

The official score is `scoreIcp`. Weights are industry 20, size 15, geography 15, buyer 10, need 15, trigger 10, technology 15. Fewer than two known dimensions is `UNRATED`. A size miss against a configured size list scores 0 and grade `D`. Grades are A at 80, B at 60, C at 40, otherwise D. A model explanation is optional and cannot change the stored score.

No email or WhatsApp sender is part of this plan.
