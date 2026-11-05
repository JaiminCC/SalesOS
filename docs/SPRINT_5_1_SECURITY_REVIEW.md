# Sprint 5.1 security review

Reviewed on 5 November 2026 against the code in this working tree.

## Owner assignment

`member_is_assignable` is the only new privilege granted to `salesos_app`. It returns a boolean. `list_user_memberships` stays revoked from `salesos_app` and `salesos_worker`. `SELECT` on `users` stays revoked from `salesos_app`. The directory role gained `SELECT` on `users` so the definer function can read `users.status`. That role cannot log in.

The integration test covered an active member, a member of another organization, a removed member, a suspended member, an invited user, an unknown id, a viewer, a bulk batch with one missing id, and an audit row. Takeover stayed `HUMAN_OWNED` after assignment.

The assignment transaction checks the function before it writes and again before it commits. A revocation that commits after the second check can still be stored. The next assignment sees it.

## Lead model path

The lead plan has no `action.proposal.create` step. The acceptance run stored zero actions. `externalSend` on the qualification response is false. The official score is recomputed in `lead.qualification.propose`. The model text is stored as `explanation` and is not written into employee, revenue, contact, or citation columns.

Company description is labeled untrusted in the prompt. Citation ids on the report come from the pinned product context, not from text the model invents into the account.

## Isolation and input

Foreign-tenant account read returned 404. Foreign-tenant search returned zero rows. A lead sort field outside the allow-list returned 400. CSV formula cells are prefixed on import, and failed-row CSV export passes the error text through `neutralizeCsvFormula`.

Eligibility still fails closed. Suppression and human takeover were evaluated from stored rows. Consent remained unknown until a known consent row exists. Quiet-hours behavior, including the America/New_York daylight-saving cases, stays in `packages/shared/src/crm.spec.ts`.

## What was not opened

No email or WhatsApp sender was added. No external discovery credential was added. Published product versions are still immutable through the product API. Forced RLS and the existing role split were not relaxed.
