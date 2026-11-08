# WhatsApp CRM integration

Customer numbers are accepted only when the provider `from` value is an optional leading `+` followed by 8 to 15 digits. The stored form is `+` plus those digits. This is not a country-plan lookup. The repository does not include a phone-number library, so a missing country code is not guessed. A value that does not match is an unknown recipient and raises an alert. No conversation is created for it.

Automatic linking uses the existing contact `phone_hmac` inside the same tenant. One match links the contact. More than one match is `REVIEW_REQUIRED`. No match is `UNKNOWN`. Display names are not used. A person with `whatsapp.conversations.manage` can link or clear a contact and lead. The choice is audited. Another tenant's contacts are not queried.
