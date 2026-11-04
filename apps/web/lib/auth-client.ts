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

export type CatalogProduct = {
  id: string;
  organizationId: string;
  name: string;
  productType: string;
  category: string;
  shortDescription: string;
  detailedDescription: string;
  website: string;
  status: string;
  tags: string[];
  targetMarkets: string[];
  languages: string[];
  currency: string;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  draftVersionId?: string | null;
  publishedVersionId?: string | null;
};

export type ProductVersion = {
  id: string;
  versionNumber: number;
  status: string;
  revision: number;
  publishedAt: string | null;
  snapshot: null | {
    icps: IcpRecord[];
    positioning: Record<string, unknown>;
    pricing: { model: string; visible: boolean; currency: string; summary: string; tiers: Array<{ name: string; amount?: string; unit?: string }> };
    knowledgeDocumentIds: string[];
  };
};

export type IcpRecord = {
  id: string;
  name: string;
  priority: number;
  archived: boolean;
  industries: string[];
  companySizes: string[];
  countries: string[];
  buyerTitles: string[];
  painPoints: string[];
  exclusionCriteria: string[];
  languages: string[];
};

export type KnowledgeDocument = {
  id: string;
  fileName: string;
  status: string;
  semanticStatus: string;
  failureReason: string | null;
  byteSize: number;
  contentType: string;
  chunks?: Array<{ id: string; content: string; page: number | null; section: string | null }>;
};

const productPath = (id: string, suffix = '') => `/api/v1/products/${id}${suffix}`;

export function listProducts(query = '') {
  return authRequest<{ items: CatalogProduct[]; page: number; pageSize: number; total: number }>(`/api/v1/products${query}`);
}

export function createProduct(body: Record<string, unknown>) {
  return authRequest<CatalogProduct>('/api/v1/products', { method: 'POST', body: JSON.stringify(body) });
}

export function getProduct(id: string) {
  return authRequest<CatalogProduct>(productPath(id));
}

export function updateProduct(id: string, body: Record<string, unknown>) {
  return authRequest<CatalogProduct>(productPath(id), { method: 'PATCH', body: JSON.stringify(body) });
}

export function duplicateProduct(id: string) {
  return authRequest<CatalogProduct>(productPath(id, '/duplicate'), { method: 'POST' });
}

export function archiveProduct(id: string) {
  return authRequest<CatalogProduct>(productPath(id, '/archive'), { method: 'POST' });
}

export function restoreProduct(id: string) {
  return authRequest<CatalogProduct>(productPath(id, '/restore'), { method: 'POST' });
}

export function listProductVersions(id: string) {
  return authRequest<ProductVersion[]>(productPath(id, '/versions'));
}

export function updateProductVersion(id: string, versionId: string, body: Record<string, unknown>) {
  return authRequest<ProductVersion>(productPath(id, `/versions/${versionId}`), { method: 'PATCH', body: JSON.stringify(body) });
}

export function transitionVersion(id: string, versionId: string, action: 'submit' | 'approve' | 'reject' | 'publish' | 'archive' | 'restore', body?: Record<string, unknown>) {
  return authRequest<ProductVersion>(productPath(id, `/versions/${versionId}/${action}`), { method: 'POST', body: body ? JSON.stringify(body) : undefined });
}

export function listIcps(id: string) {
  return authRequest<IcpRecord[]>(productPath(id, '/icps'));
}

export function addIcp(id: string, body: Record<string, unknown>) {
  return authRequest<IcpRecord[]>(productPath(id, '/icps'), { method: 'POST', body: JSON.stringify(body) });
}

export function archiveIcp(id: string, icpId: string) {
  return authRequest<IcpRecord[]>(productPath(id, `/icps/${icpId}/archive`), { method: 'POST' });
}

export function listKnowledge(id: string) {
  return authRequest<KnowledgeDocument[]>(productPath(id, '/knowledge'));
}

export function uploadKnowledge(id: string, body: { fileName: string; contentBase64: string }) {
  return authRequest<KnowledgeDocument>(productPath(id, '/knowledge'), { method: 'POST', body: JSON.stringify(body) });
}

export function reviewKnowledge(id: string, documentId: string, action: 'approve' | 'reject', reason?: string) {
  return authRequest<KnowledgeDocument>(productPath(id, `/knowledge/${documentId}/${action}`), {
    method: 'POST',
    body: JSON.stringify(action === 'reject' ? { reason } : {}),
  });
}

export function searchKnowledge(id: string, body: { query: string; mode: 'keyword' | 'semantic' }) {
  return authRequest<{ requestedMode: string; mode: string; semanticAvailable: boolean; results: Array<{ chunkId: string; documentId: string; fileName: string; page: number | null; section: string | null; content: string; score: number | null }> }>(
    productPath(id, '/knowledge/search'),
    { method: 'POST', body: JSON.stringify(body) },
  );
}

export function previewProductContext(id: string, body: { query: string; versionId?: string }) {
  return authRequest<Record<string, unknown>>(productPath(id, '/context/preview'), { method: 'POST', body: JSON.stringify(body) });
}

export async function downloadKnowledge(id: string, documentId: string, fileName: string) {
  const response = await fetch(authPath(productPath(id, `/knowledge/${documentId}/download`)), { credentials: 'include' });
  if (!response.ok) throw new Error(`Download failed (${response.status})`);
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}
