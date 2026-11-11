# Calendar CRM integration

An internal meeting can reference a lead, contact, and account in the same tenant. A foreign id is `NOT_FOUND`. Creating the meeting writes a `crm_activities` row of kind `MEETING`. It does not change the lead stage and does not set WON or LOST.

Follow-up tasks are `calendar_tasks` rows. They are not emails and not WhatsApp messages. Outcomes are `HELD`, `NO_SHOW`, `CANCELLED`, `RESCHEDULED`, `FOLLOW_UP_REQUIRED`, `QUALIFIED`, `NOT_QUALIFIED`, and `UNKNOWN`. An outcome requires `calendar.meetings.manage`. Notes require `calendar.notes.manage` and are omitted from the read model otherwise. AI proposal text is stored as a draft agenda with `REVIEW_REQUIRED`, not as a verified outcome.
