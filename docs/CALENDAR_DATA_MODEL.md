# Calendar data model

See section 19 of `docs/DATABASE_DESIGN.md`. Tenant-owned calendar tables use forced row-level security and the `tenant_isolation` policy. Composite foreign keys stay inside the tenant. Credentials store ciphertext and a hint. OAuth verifiers are encrypted. Management responses do not return ciphertext.

Private provider event bodies are not copied. Graph subjects are dropped in the read adapter. The external-link row stores an internal correlation id and `CLOSED_GATE` only.
