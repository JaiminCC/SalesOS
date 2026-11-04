# SalesOS Production Engineering Backlog (not implemented in visual prototype)

## P0: Real platform foundations
- NestJS API, authenticated org and membership model, permissions, audit log, tenant-scoped PostgreSQL with RLS.
- Redis/BullMQ workers, idempotency keys, retries, backoff, dead-letter queues, job cancellation and operator intervention.
- Provider adapter interfaces: `LeadSource`, `Mailbox`, `Calendar`, `MeetingArtifact`, `LLM`; OAuth credential vault and scopes.
- Evidence-cited research with URL, timestamp, source permission, relevance and freshness checks; contact lawful-basis review.
- Sales agent state machines and strict JSON-schema outputs; tool authorization at executor, not from LLM text.
- Message policy enforcement: do-not-contact, unsubscribe, suppression, country rules, quiet windows, caps, DKIM/SPF/DMARC.
- Inbox webhooks/polling with threading, sentiment/intent classification, grounding, escalation and human takeover.
- Meeting booking with provider-confirmed availability and explicit buyer choice; timezone and rescheduling constraints.
- Authorized transcript/notes ingestion with participant notice, per-meeting evidence, retention policies and controlled sharing.
- Commercial quote/guarantee safeguards, policy decision logs and human approval gates.

## P1: Commercial multi-tenant SaaS
- Tenant provisioning, isolation tests, subscription lifecycle, quotas, rate limits, metering, usage billing.
- Knowledge ingestion and versioning for multiple products, locale and buyer profile templates.
- Dynamic lead source connectors, job signal detection, stale-source safeguards and provenance UI.
- Role-based dashboards, attribution reports, controlled A/B experiments and conversion analytics.
- Incident monitoring, backups and restore drills, encrypted PII, DSR lifecycle, security scanning, E2E test suite.

## Roles
- Tenant Owner, Admin, Sales Manager, Sales Executive, Reviewer, Viewer, Platform Operator.
- Default deny for cross-tenant access; independent permission scopes for data read, message sending, scheduling, approvals, model config and integrations.

## MVP go/no-go criteria
- 0 unapproved external sends, 0 fabricated provider successes, 0 cross-tenant reads in negative authorization tests.
- 100% unsubscribe suppression in deterministic test suite; provider booking acknowledgements verified.
- At least 95% of a reviewed, domain-specific intent test set classified correctly; no fabricated pricing or security claims.
- Human can pause all outbound actions and cancel pending jobs. Every consequential action has a tamper-evident audit event.
