# Calendar approvals

Sprint 11 reuses `audit_events` and adds `calendar_approvals` for the exact meeting version. The digest is the version, organizer, UTC interval, and agenda. A second decision with the same digest is `APPROVAL_REPLAY`. The author of the meeting cannot approve it: `SELF_APPROVAL`.

`APPROVED_INTERNAL` does not call a provider. Editing the interval through reschedule changes the version and requires a new approval when the meeting type says so. There is no route that turns an approval into an external event.
