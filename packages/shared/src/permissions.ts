export const PERMISSIONS = [
  'leads.read',
  'leads.write',
  'campaigns.manage',
  'outreach.send_approved',
  'approvals.review',
  'agents.configure',
  'connectors.manage',
  'users.manage',
  'users.invite',
  'audit.read',
  'tenant.export',
  'products.read',
  'products.write',
  'products.publish',
  'automation.pause',
  'meetings.book',
  'meetings.manage',
  'organizations.manage',
  'roles.manage',
  'conversations.read',
  'conversations.reply',
  'agents.read',
  'agents.manage',
  'integrations.manage',
  'approvals.manage',
  'settings.manage',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const SYSTEM_ROLES = [
  'Owner',
  'Admin',
  'Manager',
  'Sales',
  'Analyst',
  'Reviewer',
  'OWNER',
  'ADMIN',
  'SALES_MANAGER',
  'SALES_AGENT',
  'VIEWER',
] as const;

export const OWNER_ROLE_NAMES = ['OWNER', 'Owner'] as const;

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
  OWNER: ALL,
  ADMIN: ALL.filter((permission) => permission !== 'tenant.export'),
  SALES_MANAGER: [
    'products.read',
    'products.write',
    'leads.read',
    'leads.write',
    'campaigns.manage',
    'conversations.read',
    'conversations.reply',
    'agents.read',
    'meetings.manage',
    'approvals.manage',
    'audit.read',
  ],
  SALES_AGENT: [
    'products.read',
    'leads.read',
    'leads.write',
    'conversations.read',
    'conversations.reply',
    'agents.read',
    'meetings.manage',
  ],
  VIEWER: ['products.read', 'leads.read', 'conversations.read', 'agents.read', 'audit.read'],
};

export function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value);
}
