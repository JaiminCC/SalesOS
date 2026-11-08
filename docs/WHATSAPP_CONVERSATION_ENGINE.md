# WhatsApp conversation engine

A conversation is the tenant, business phone, and customer E.164. It is not the provider's conversation id. States are `OPEN`, `AI_REVIEW`, `HUMAN_ASSIGNED`, `WAITING_CUSTOMER`, `RESOLVED`, `CLOSED`, and `BLOCKED`.

An inbound message updates the last inbound time, unread count, predicted intent, and service window. It does not create a CRM lead. Intent values are predictions with a review state of `PREDICTION`. They do not set a lead to won or lost and do not book a meeting.

Human takeover sets `ai_enabled` false and records an assignment. Release turns AI assistance back on. A removed membership cannot be assigned. Takeover blocks a new autonomous draft.
