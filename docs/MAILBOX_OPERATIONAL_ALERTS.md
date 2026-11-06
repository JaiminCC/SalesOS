# Mailbox operational alerts

Alerts are rows in `mailbox_operational_alerts`. They are created when a classified sync failure has no open alert for the same mailbox and code. An acknowledged alert is not recreated, because the dedupe key stays unique.

Acknowledgement sets `ACKNOWLEDGED`, records the member, and writes a health event. It does not send mail, release quota, or change a delivery attempt.

Alerts are visible only for mailboxes the member can access. They are not emailed, and Sprint 8 does not add SMS, WhatsApp, or an external notification service.
