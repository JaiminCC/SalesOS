# Contact eligibility

`evaluateEligibility` can return more than one reason, and it never treats a missing fact as permission.

| Condition | State |
|---|---|
| Suppression or ownership lookup throws | `REVIEW_REQUIRED` |
| Active suppression on the account, contact, or email HMAC | `SUPPRESSED` |
| Active lead takeover | `HUMAN_OWNED` |
| Consent is not `KNOWN` | `CONSENT_UNKNOWN` |
| Contact verification is not `VERIFIED` | `CONTACT_DETAILS_UNVERIFIED` |
| All of the above are clear | `ELIGIBLE` |

Imported contacts start at `UNKNOWN` consent and `UNKNOWN` verification, so a new lead is not eligible. A public business email is stored as an encrypted value. It is not consent. The eligibility row stores the state, reasons, facts, and policy version `mvp-1`. The lead's `eligibility_state` is updated. `suppression_state` becomes `SUPPRESSED` or `CLEAR`.

The response includes the quiet-hours decision and `externalSend: false`. The policy engine, when a proposal is tied to a lead, blocks suppressed and human-owned external actions and requires approval for unknown consent or an unknown quiet-hours result. There is still no sender. This implementation does not claim that an organization is compliant with every privacy or marketing law.
