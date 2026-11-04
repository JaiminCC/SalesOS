export const PERMISSIONS = [
  'leads.read',
  'leads.write',
  'campaigns.manage',
  'outreach.send_approved',
  'approvals.review',
  'agents.configure',
  'connectors.manage',
  'users.manage',
  'audit.read',
  'tenant.export',
  'products.write',
  'products.publish',
  'automation.pause',
  'meetings.book',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const SYSTEM_ROLES = ['Owner', 'Admin', 'Manager', 'Sales', 'Analyst', 'Reviewer'] as const;

export type SystemRole = (typeof SYSTEM_ROLES)[number];

const ALL: readonly Permission[] = PERMISSIONS;

export const SYSTEM_ROLE_PERMISSIONS: Record<SystemRole, readonly Permission[]> = {
  Owner: ALL,
  Admin: [
    'leads.read',
    'leads.write',
    'campaigns.manage',
    'approvals.review',
    'agents.configure',
    'connectors.manage',
    'users.manage',
    'audit.read',
    'tenant.export',
    'products.write',
    'products.publish',
    'automation.pause',
    'meetings.book',
  ],
  Manager: [
    'leads.read',
    'leads.write',
    'campaigns.manage',
    'outreach.send_approved',
    'approvals.review',
    'agents.configure',
    'audit.read',
    'products.write',
    'meetings.book',
  ],
  Sales: ['leads.read', 'leads.write', 'outreach.send_approved', 'meetings.book'],
  Analyst: ['leads.read', 'audit.read'],
  Reviewer: ['leads.read', 'approvals.review', 'audit.read'],
};

export function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value);
}
