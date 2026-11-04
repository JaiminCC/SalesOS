export const TENANT_TABLES = [
  'memberships',
  'roles',
  'role_permissions',
  'membership_roles',
  'audit_events',
  'outbox_events',
  'idempotency_keys',
  'job_executions',
] as const;

export type TenantTable = (typeof TENANT_TABLES)[number];
