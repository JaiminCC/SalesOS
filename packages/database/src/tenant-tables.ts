export const TENANT_TABLES = [
  'memberships',
  'roles',
  'role_permissions',
  'membership_roles',
  'audit_events',
  'outbox_events',
  'idempotency_keys',
  'job_executions',
  'invitations',
  'products',
  'product_versions',
  'knowledge_documents',
  'knowledge_chunks',
  'knowledge_embeddings',
  'embedding_indexes',
  'organization_product_defaults',
  'navigation_contexts',
] as const;

export type TenantTable = (typeof TENANT_TABLES)[number];
