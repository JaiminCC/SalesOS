export type AuthSession = {
  user: { id: string; email: string; displayName: string };
  organizationId: string | null;
  roles: string[];
  permissions: string[];
  sessionId: string;
};

export type OrganizationSummary = {
  id: string;
  name: string;
  slug: string;
  status: string;
  membershipStatus: string;
  roles: string[];
};

type ErrorBody = { error?: { code?: string; message?: string } };

function authPath(path: string): string {
  if (typeof window === 'undefined') {
    const base = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://127.0.0.1:3001';
    return `${base}${path}`;
  }
  return `/backend${path}`;
}

async function authRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const method = (init.method ?? 'GET').toUpperCase();
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (method !== 'GET') headers.set('X-Salesos-Csrf', '1');
  const response = await fetch(authPath(path), { ...init, method, headers, credentials: 'include' });
  if (response.status === 204) return undefined as T;
  const body = (await response.json().catch(() => null)) as ({ data: T } & ErrorBody) | null;
  if (!response.ok) {
    throw new Error(body?.error?.message || `Request failed (${response.status})`);
  }
  return body!.data;
}

export function registerAccount(input: { email: string; password: string; displayName: string; organizationName: string }) {
  return authRequest<{ accepted: boolean }>('/api/v1/auth/register', { method: 'POST', body: JSON.stringify(input) });
}

export function loginAccount(input: { email: string; password: string; remember: boolean }) {
  return authRequest<AuthSession>('/api/v1/auth/login', { method: 'POST', body: JSON.stringify(input) });
}

export function logoutAccount() {
  return authRequest<void>('/api/v1/auth/logout', { method: 'POST' });
}

export function forgotPassword(email: string) {
  return authRequest<{ accepted: boolean }>('/api/v1/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) });
}

export function resetPassword(token: string, password: string) {
  return authRequest<void>('/api/v1/auth/reset-password', { method: 'POST', body: JSON.stringify({ token, password }) });
}

export function verifyEmail(token: string) {
  return authRequest<void>('/api/v1/auth/verify-email', { method: 'POST', body: JSON.stringify({ token }) });
}

export function currentSession() {
  return authRequest<AuthSession>('/api/v1/auth/me').catch(() => null);
}

export function listOrganizations() {
  return authRequest<OrganizationSummary[]>('/api/v1/organizations');
}

export function switchOrganization(id: string) {
  return authRequest<void>(`/api/v1/organizations/${id}/switch`, { method: 'POST' });
}

export function createOrganization(name: string) {
  return authRequest<{ id: string; name: string }>('/api/v1/organizations', { method: 'POST', body: JSON.stringify({ name }) });
}

export function acceptInvitation(token: string) {
  return authRequest<{ organizationId: string; role: string }>('/api/v1/invitations/accept', { method: 'POST', body: JSON.stringify({ token }) });
}

export function listMembers(id: string) {
  return authRequest<Array<{ userId: string; displayName: string; email: string; status: string; roles: string[] }>>(
    `/api/v1/organizations/${id}/members`,
  );
}

export function inviteMember(id: string, email: string, role: string) {
  return authRequest<{ accepted: boolean }>(`/api/v1/organizations/${id}/invitations`, {
    method: 'POST',
    body: JSON.stringify({ email, role }),
  });
}

export function updateMemberRole(id: string, userId: string, role: string) {
  return authRequest<void>(`/api/v1/organizations/${id}/members/${userId}`, {
    method: 'PATCH',
    body: JSON.stringify({ role }),
  });
}

export function listSessions() {
  return authRequest<Array<{ id: string; createdAt: string; expiresAt: string; remember: boolean; userAgent: string | null; current: boolean }>>(
    '/api/v1/auth/sessions',
  );
}

export function revokeSession(id: string) {
  return authRequest<void>(`/api/v1/auth/sessions/${id}`, { method: 'DELETE' });
}

export type RoleGrant = {
  name: string;
  system: boolean;
  permissions: string[];
};

export function listRoles() {
  return authRequest<RoleGrant[]>('/api/v1/roles');
}

export function listPermissions() {
  return authRequest<string[]>('/api/v1/permissions');
}

export function listAudit(id: string) {
  return authRequest<Array<{ id: string; actorId: string | null; action: string; entityType: string; entityId: string; createdAt: string; requestId: string | null }>>(
    `/api/v1/organizations/${id}/audit`,
  );
}
