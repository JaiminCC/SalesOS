# WhatsApp template management

Local templates have categories `MARKETING`, `UTILITY`, and `AUTHENTICATION`. A new edit creates a new version. The local status starts at `LOCAL_DRAFT`. The provider status starts at `PROVIDER_UNKNOWN`.

Variables may be numbered placeholders or `contact_first_name`, `company_name`, and `product_name`. Script, interpolation, and unknown names are rejected. A preview shows a real value, a labeled sample, or leaves the placeholder unknown. Missing values are not invented.

`submitWhatsAppTemplate` throws before any network call. The database check rejects `PROVIDER_APPROVED`. An administrator approving a draft does not make it Meta-approved.
