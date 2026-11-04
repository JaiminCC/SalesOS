# SalesOS UX flows and prototype wiring

## Identity
A01 Sign in → A04 MFA → A05 Organization switch (optional) → A06 New workspace (first login) → C01 Command Center.
A01 Forgot password → A02 Reset request → A03 Reset form → A01. SSO button on A01 → A05. Incorrect/expired token should show error and new recovery route.

## Agent-first sales operation
C12 Products & Knowledge → G11 Agent Builder → G09 Agent Control Center → C02 Lead Discovery → C03 Lead Research → C04 Campaign Builder → C09 Approval Center → C05 AI Inbox → C06 Qualification → C07 Meeting Calendar → C08 Meeting Intelligence → C10 Pipeline → C11 Analytics.
G01 Supervisor orchestrates G02 Research, G03 Outreach, G04 Conversation, G05 Qualification, G06 Meeting, G07 Meeting Intelligence, and G08 Follow-up & Insights. G10 Execution Inspector captures every planned/policy/actual step.

## Administration
C01 → E01 Preferences; E02 Security; E03 SSO; E04 Users & Roles; E05 Marketplace → E06 Connector Properties; E07 WhatsApp Business → E08 Bot Studio → E09 Templates & Opt-ins; E10 Webhooks; E11 Audit; E12 Global Settings.

## Mobile
M01 Command Center → M02 Agent Activity → M03 Inbox → M04 Meeting Brief → M05 Approvals → M06 Settings.

## Interaction states to wire in Figma
- Agents: active / paused / failed / awaiting approval / human takeover.
- External side effects: planned / queued / approved / dispatched / provider-acknowledged / failed / retried.
- Email: draft / requires review / approved / sending / sent / delivered / bounced / opted-out.
- SSO: provider draft / validated / active / disabled / failed.
- WhatsApp: opt-in verified / within 24-hour service window / template approved / handoff / suppressed.
- Meetings: proposed / buyer-confirmed / provider-created / attendee notified / concluded / transcript authorized / notes reviewed.
- Security: login failure / MFA challenge / session revoke / password recovery / audit export.

Prototype controls must distinguish UI simulation from API-confirmed real action. Include loading, empty, error, revoked, unauthorized, rate-limited and no-evidence variants in production.
