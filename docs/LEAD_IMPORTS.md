# Lead imports

CSV import accepts company name, website, industry, country, contact name, job title, business email, business phone, and source. The file must be under 1,000,000 bytes and 500 data rows. `parseCsv` rejects NUL bytes, handles quotes and a leading BOM, and prefixes a single quote when a cell starts with `=`, `+`, `-`, or `@`. Parsing does not fetch URLs and does not evaluate formulas.

The request flow is preview, then execute. Execute stores a batch with an idempotency key. The same key returns the original batch. Rows without a company name are `FAILED`. A domain that already exists is `SKIPPED` when the policy is `skip`. A new company is `SOURCE_REPORTED`. An imported contact keeps consent `UNKNOWN` and verification `UNKNOWN`. The provenance object records that lawful use was not established. A repeated email HMAC is not inserted again.

Batch status is `COMPLETED` when every processed row succeeded or was skipped, `PARTIAL` when some rows failed and some were created, and `FAILED` when nothing was created. `lead-imports/retry` returns failed rows to `PENDING` and runs the batch again. `lead-imports/errors` returns a small CSV of row numbers and error text. The API and the worker share `importCrmBatch`. The worker claims a `QUEUED` batch. A completed batch is not applied twice.
