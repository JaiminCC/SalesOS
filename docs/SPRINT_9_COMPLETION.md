# Sprint 9 completion

Signed-in campaigns, segments, sequences, templates, simulation, and analytics are stored in PostgreSQL. The signed-out campaigns page remains the demonstration. External delivery is not authorized.

What shipped:

- Forward migrations `20261108120000_campaigns` and `20261108130000_campaign_schedule_drain`.
- A validated lifecycle. `APPROVED` and `COMPLETED_SIMULATION` are not sent states.
- A bounded segment filter. Snapshot versions freeze. Dynamic filters re-evaluate.
- Preparation eligibility that keeps unknown consent, suppression, and human takeover out of the eligible set.
- Versioned sequences, waits, and stop checks. Reply detection stays unavailable without a configured mailbox.
- Supervisor plan `CAMPAIGN_PREPARE_AND_PERSONALIZE` with internal tools only.
- Separate human approvals. The author cannot approve their own configuration.
- Durable simulation with idempotent steps, pause, cancel, and SIGKILL recovery.
- Analytics from those rows. External sent, delivered, replies, meetings, and conversions are `NOT AVAILABLE`.

What did not ship:

- No email send, WhatsApp send, provider adapter call, or send-quota consumption.
- No live mailbox connection. Automated reply detection is unavailable.
- No Sprint 10 work.

Limitations:

- Audience evaluation refuses when an organization has more than 500 active leads. It does not return a truncated audience as complete.
- The browser spec does not click a separate reviewer, pause, or a seeded suppressed contact. Those behaviors are covered by `campaign-work.spec.ts` and `campaign-kill.spec.ts`.
- Template changes after the first version are a new template.
- WhatsApp and call steps are rejected rather than stored as future steps.
