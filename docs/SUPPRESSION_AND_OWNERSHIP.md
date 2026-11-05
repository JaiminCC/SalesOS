# Suppression and ownership

Suppression scopes are organization, contact, email, phone, account, and channel. The reason is free text supplied by a member with `crm.suppression.manage`. An email or phone subject is stored as an HMAC and a four-character hint. List responses do not include the HMAC or the original value. Removal sets `active` false, `removed_at`, and `removed_by`. The row stays so a later review can see that the restriction existed.

Eligibility checks the account id, the contact id, and the contact email HMAC. If that query fails, the decision is `REVIEW_REQUIRED`. A merge moves active suppressions from the archived company onto the kept company.

Owner assignment writes `crm_assignments`, closes the previous open assignment, and sets `crm_leads.owner_user_id`. It does not end a takeover. Takeover is `crm_takeovers` with `subject_type` of account, contact, or lead. An active takeover makes eligibility `HUMAN_OWNED` and makes an external proposal `BLOCK` with reason `HUMAN_OWNED`. Clearing a takeover is an explicit request with `active: false`.

The application role cannot read the membership table. The screen sends the signed-in user id from `GET /api/v1/auth/me`. The assignment stores that id. It does not grant a new permission by itself.
