# Sales sequence engine

A sequence has versions. `sequences/freeze` marks the current version frozen. A frozen version cannot be replaced. An enrollment stores the version id it started with.

Step types that can be saved are `EMAIL_DRAFT`, `WAIT_DURATION`, `WAIT_UNTIL`, `CONDITION`, `HUMAN_TASK`, `APPROVAL_GATE`, and `END_SEQUENCE`. `WHATSAPP` and `CALL` fail validation with `CHANNEL_UNSUPPORTED`. A sequence may have 12 steps and a horizon of 90 days. The graph is the linear `next` link plus `whenTrue` and `whenFalse`. A cycle or a missing end step is rejected. Conditions are stored rows. They are not JavaScript or SQL.

`EMAIL_DRAFT` writes a campaign draft. It does not create a mailbox send intent. `APPROVAL_GATE` and `HUMAN_TASK` leave the enrollment in `WAITING_APPROVAL`. `END_SEQUENCE` completes the simulation for that enrollment.

Stop reasons are a verified reply, human takeover, suppression, withdrawn consent, a disqualified or archived lead, an invalid contact, a suspended tenant, a paused or cancelled campaign, the step limit, the end date, and a manual stop. The reply flag is set only by a verified mailbox event or an authorized manual action. This workspace has no configured mailbox, so reply detection is `UNAVAILABLE` and a missing reply does not stop the sequence.
