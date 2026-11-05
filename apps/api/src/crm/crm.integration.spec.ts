import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createPrismaClient, decodeEncryptionKey, emailHmac } from '@salesos/database';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../app.module';
import { AllExceptionsFilter } from '../common/all-exceptions.filter';

process.env.SALESOS_PROCESS_AGENTS = 'inline';
const password = 'correct-horse-battery';

describe.skipIf(!process.env.DATABASE_URL || !process.env.DATABASE_URL_APP || !process.env.DATA_ENCRYPTION_KEY)('lead intelligence', () => {
  let app: INestApplication;
  const admin = createPrismaClient(process.env.DATABASE_URL as string);
  const key = decodeEncryptionKey(process.env.DATA_ENCRYPTION_KEY as string);
  const stamp = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  let ownerCookie = '';
  let otherCookie = '';
  let accountId = '';
  let leadId = '';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await admin.$disconnect();
  });

  it('keeps companies, scores, and contact restrictions inside the organization', async () => {
    ownerCookie = await login(`crm-owner-${stamp}@example.com`, 'CRM Owner Org');
    otherCookie = await login(`crm-other-${stamp}@example.com`, 'CRM Other Org');
    const me = await request(app.getHttpServer()).get('/api/v1/auth/me').set('Cookie', ownerCookie);
    const tenantId = me.body.data.organizationId as string;
    const userId = me.body.data.user.id as string;
    const inserted = await admin.$queryRaw<Array<{ id: string }>>`
      INSERT INTO products (tenant_id, name, product_type, created_by, updated_by)
      VALUES (${tenantId}::uuid, 'Field Kit', 'PHYSICAL', ${userId}::uuid, ${userId}::uuid)
      RETURNING id`;
    const product = inserted[0];
    await admin.productVersion.create({
      data: {
        tenantId,
        productId: product!.id,
        versionNumber: 1,
        status: 'PUBLISHED',
        snapshot: { icps: [{ id: randomUUID(), name: 'Field operators', priority: 1, industries: ['Logistics'], countries: ['US'], companySizes: ['51-200'] }] },
        publishedAt: new Date(),
        createdBy: userId,
        updatedBy: userId,
      },
    });

    const account = await post('/api/v1/management/accounts/create').set('Cookie', ownerCookie).send({
      legalName: 'Northwind Logistics', website: 'https://northwind.example', industry: 'Logistics', country: 'US', sizeRange: '51-200', description: 'Needs offline barcode capture',
    });
    expect(account.status).toBe(200);
    accountId = account.body.data.id;
    expect(account.body.data.employeeStatus).toBe('UNKNOWN');
    const hidden = await post('/api/v1/management/accounts/get').set('Cookie', otherCookie).send({ id: accountId });
    expect(hidden.status).toBe(404);
    const foreignList = await post('/api/v1/management/accounts/list').set('Cookie', otherCookie).send({ q: 'Northwind' });
    expect(foreignList.body.data.total).toBe(0);

    const contact = await post('/api/v1/management/contacts/create').set('Cookie', ownerCookie).send({
      accountId, name: 'Ada North', email: 'ada@northwind.example', jobTitle: 'Operations',
    });
    expect(contact.status).toBe(200);
    expect(contact.body.data.consentState).toBe('UNKNOWN');
    expect(contact.body.data.verificationStatus).toBe('UNKNOWN');

    const lead = await post('/api/v1/management/leads/create').set('Cookie', ownerCookie).send({
      accountId, contactId: contact.body.data.id, productId: product!.id, sourceType: 'manual',
    });
    expect(lead.status).toBe(200);
    leadId = lead.body.data.id;
    expect(lead.body.data.eligibilityState).toBe('CONSENT_UNKNOWN');

    const scored = await post('/api/v1/management/qualification/run').set('Cookie', ownerCookie).send({ id: leadId });
    expect(scored.status).toBe(200);
    expect(scored.body.data.score).toBe(65);
    expect(scored.body.data.grade).toBe('B');
    expect(scored.body.data.externalSend).toBe(false);
    const again = await post('/api/v1/management/qualification/run').set('Cookie', ownerCookie).send({ id: leadId });
    expect(again.body.data.score).toBe(scored.body.data.score);

    const imported = await post('/api/v1/management/lead-imports/execute').set('Cookie', ownerCookie).send({
      fileName: 'leads.csv',
      idempotencyKey: `crm-${stamp}`,
      policy: 'skip',
      csv: 'companyName,website,industry,country\nNorthwind Logistics,https://northwind.example,Logistics,US\n=cmd|calc,https://evil.example,Logistics,US\n,https://missing.example,Logistics,US\n',
    });
    expect(imported.status).toBe(200);
    expect(imported.body.data.status).toBe('PARTIAL');
    const replay = await post('/api/v1/management/lead-imports/execute').set('Cookie', ownerCookie).send({
      fileName: 'leads.csv', idempotencyKey: `crm-${stamp}`, policy: 'skip', csv: 'companyName\nIgnored\n',
    });
    expect(replay.body.data.id).toBe(imported.body.data.id);

    const discovery = await post('/api/v1/management/discovery/create').set('Cookie', ownerCookie).send({ providerId: 'test', maxCandidates: 5 });
    expect(discovery.status).toBe(200);
    expect(discovery.body.data.live).toBe(false);
    expect(discovery.body.data.candidates[0].live).toBe(false);
    expect(discovery.body.data.candidates[0].name).toBe('Northwind Logistics');

    const suppressed = await post('/api/v1/management/suppression/create').set('Cookie', ownerCookie).send({
      scope: 'email', reason: 'Do not contact', subject: 'ada@northwind.example',
    });
    expect(suppressed.status).toBe(200);
    const blocked = await post('/api/v1/management/eligibility/evaluate').set('Cookie', ownerCookie).send({ id: leadId });
    expect(blocked.body.data.state).toBe('SUPPRESSED');
    expect(blocked.body.data.externalSend).toBe(false);
    await post('/api/v1/management/suppression/remove').set('Cookie', ownerCookie).send({ id: suppressed.body.data.id });
    await post('/api/v1/management/ownership/takeover').set('Cookie', ownerCookie).send({ id: leadId, subjectType: 'lead', reason: 'Human is speaking', active: true });
    const owned = await post('/api/v1/management/eligibility/evaluate').set('Cookie', ownerCookie).send({ id: leadId });
    expect(owned.body.data.state).toBe('HUMAN_OWNED');

    const duplicateIds = await post('/api/v1/management/accounts/archive').set('Cookie', ownerCookie).send({ ids: [accountId, accountId] });
    expect(duplicateIds.status).toBe(400);
    const listed = await post('/api/v1/management/leads/list').set('Cookie', ownerCookie).send({ q: 'Northwind', page: 1, pageSize: 10, sortBy: 'score', sortDirection: 'desc' });
    expect(listed.body.data.total).toBe(1);
    expect(listed.body.data.items[0].score).toBe(65);

    const fresh = await post('/api/v1/management/leads/get').set('Cookie', ownerCookie).send({ id: leadId });
    const assigned = await post('/api/v1/management/leads/assign').set('Cookie', ownerCookie).send({ id: leadId, revision: fresh.body.data.revision, ownerUserId: userId, reason: 'Active owner' });
    expect(assigned.status).toBe(200);
    expect(assigned.body.data.ownerUserId).toBe(userId);
    const stillOwned = await post('/api/v1/management/eligibility/evaluate').set('Cookie', ownerCookie).send({ id: leadId });
    expect(stillOwned.body.data.state).toBe('HUMAN_OWNED');
    const current = await post('/api/v1/management/leads/get').set('Cookie', ownerCookie).send({ id: leadId });
    const unknownOwner = await post('/api/v1/management/leads/assign').set('Cookie', ownerCookie).send({ id: leadId, revision: current.body.data.revision, ownerUserId: randomUUID(), reason: 'Unknown' });
    expect(unknownOwner.status).toBe(404);
    const otherMe = await request(app.getHttpServer()).get('/api/v1/auth/me').set('Cookie', otherCookie);
    const foreignOwner = await post('/api/v1/management/leads/assign').set('Cookie', ownerCookie).send({ id: leadId, revision: current.body.data.revision, ownerUserId: otherMe.body.data.user.id, reason: 'Foreign' });
    expect(foreignOwner.status).toBe(404);
    const targetId = randomUUID();
    await admin.user.create({ data: { id: targetId, emailHmac: randomUUID(), emailCiphertext: Buffer.from([1]), displayName: 'Target', status: 'ACTIVE' } });
    await admin.membership.create({ data: { tenantId, userId: targetId, status: 'ACTIVE' } });
    const activeTarget = await post('/api/v1/management/leads/assign').set('Cookie', ownerCookie).send({ id: leadId, revision: current.body.data.revision, ownerUserId: targetId, reason: 'Member' });
    expect(activeTarget.status).toBe(200);
    await admin.membership.update({ where: { tenantId_userId: { tenantId, userId: targetId } }, data: { status: 'REMOVED' } });
    const removed = await post('/api/v1/management/leads/assign').set('Cookie', ownerCookie).send({ id: leadId, revision: activeTarget.body.data.revision, ownerUserId: targetId, reason: 'Removed' });
    expect(removed.status).toBe(404);
    await admin.membership.update({ where: { tenantId_userId: { tenantId, userId: targetId } }, data: { status: 'SUSPENDED' } });
    const suspended = await post('/api/v1/management/leads/assign').set('Cookie', ownerCookie).send({ id: leadId, revision: activeTarget.body.data.revision, ownerUserId: targetId, reason: 'Suspended' });
    expect(suspended.status).toBe(404);
    await admin.membership.update({ where: { tenantId_userId: { tenantId, userId: targetId } }, data: { status: 'ACTIVE' } });
    await admin.user.update({ where: { id: targetId }, data: { status: 'INVITED' } });
    const invited = await post('/api/v1/management/leads/assign').set('Cookie', ownerCookie).send({ id: leadId, revision: activeTarget.body.data.revision, ownerUserId: targetId, reason: 'Invited' });
    expect(invited.status).toBe(404);
    const viewerEmail = `crm-viewer-${stamp}@example.com`;
    const viewerCookie = await login(viewerEmail, `Viewer Org ${stamp}`);
    await post(`/api/v1/organizations/${tenantId}/invitations`).set('Cookie', ownerCookie).send({ email: viewerEmail, role: 'VIEWER' });
    const invitation = await admin.capturedMessage.findFirst({ where: { kind: 'invitation', recipientHmac: emailHmac(viewerEmail, key) }, orderBy: { createdAt: 'desc' } });
    expect((await post('/api/v1/invitations/accept').set('Cookie', viewerCookie).send({ token: invitation?.token })).status).toBe(200);
    expect((await post(`/api/v1/organizations/${tenantId}/switch`).set('Cookie', viewerCookie).send({})).status).toBe(204);
    const forbidden = await post('/api/v1/management/leads/assign').set('Cookie', viewerCookie).send({ id: leadId, revision: activeTarget.body.data.revision, ownerUserId: userId, reason: 'Viewer' });
    expect(forbidden.status).toBe(403);
    const bulk = await post('/api/v1/management/leads/bulk-assign').set('Cookie', ownerCookie).send({ ids: [leadId, randomUUID()], ownerUserId: userId, reason: 'Partial' });
    expect(bulk.status).toBe(200);
    expect(bulk.body.data.updated).toBe(1);
    expect(bulk.body.data.failed).toBe(1);
    const audits = await admin.auditEvent.count({ where: { tenantId, action: 'crm.lead.assign', entityId: leadId } });
    expect(audits).toBeGreaterThan(0);
    const injected = await post('/api/v1/management/leads/list').set('Cookie', ownerCookie).send({ sortBy: 'score; drop table crm_leads' });
    expect(injected.status).toBe(400);

    const model = await post('/api/v1/management/models/create').set('Cookie', ownerCookie).send({ name: 'Mock', provider: 'fake', model: 'fake-1' });
    expect(model.status).toBe(201);
    const explained = await post('/api/v1/management/qualification/run').set('Cookie', ownerCookie).send({ id: leadId, modelConfigurationId: model.body.data.id });
    expect(explained.status).toBe(200);
    expect(explained.body.data.score).toBe(65);
    expect(explained.body.data.explanationSource).toBe('deterministic');
    expect(explained.body.data.externalSend).toBe(false);
    const inspected = await post('/api/v1/management/runs/get').set('Cookie', ownerCookie).send({ id: explained.body.data.runId });
    expect(inspected.body.data.tools.map((item: { toolName: string }) => item.toolName)).toEqual([
      'lead.account.read', 'lead.contact.read', 'lead.research.evidence.read', 'lead.research.find_gaps', 'lead.icp.evaluate',
      'lead.research.summarize', 'lead.qualification.explain', 'lead.qualification.propose', 'lead.eligibility.read',
    ]);
    expect(inspected.body.data.report.officialScore).toBe(65);
    expect(inspected.body.data.usage.length).toBeGreaterThan(0);
    expect(inspected.body.data.actions).toEqual([]);
    const history = await admin.crmQualification.findMany({ where: { tenantId, leadId }, orderBy: { createdAt: 'asc' } });
    expect(history[0]?.score).toBe(65);
    expect(history.at(-1)?.modelProvider).toBeNull();
    expect(history.at(-1)?.explanation).toContain('INSUFFICIENT_EXPLANATION');
    expect(history.at(-1)?.explanation).toContain('buyer');
    expect((history.at(-1)?.dimensions as Array<{ name: string; fit: string }>).find((item) => item.name === 'buyer')?.fit).toBe('UNKNOWN');
    expect(history.at(-1)?.score).toBe(65);
  });

  async function login(email: string, organizationName: string): Promise<string> {
    expect((await post('/api/v1/auth/register').send({ email, password, displayName: email.split('@')[0], organizationName })).status).toBe(202);
    const token = await captured(email);
    expect((await post('/api/v1/auth/verify-email').send({ token })).status).toBe(204);
    const logged = await post('/api/v1/auth/login').send({ email, password });
    expect(logged.status).toBe(200);
    return pair(sessionCookie(logged));
  }

  async function captured(email: string): Promise<string> {
    const row = await admin.capturedMessage.findFirst({ where: { kind: 'email_verification', recipientHmac: emailHmac(email, key) }, orderBy: { createdAt: 'desc' } });
    if (!row?.token) throw new Error('missing verification');
    return row.token;
  }

  function post(url: string) {
    return request(app.getHttpServer()).post(url).set('x-salesos-csrf', '1');
  }
});

function sessionCookie(response: request.Response): string {
  const header = response.headers['set-cookie'];
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) throw new Error('session cookie missing');
  return value;
}

function pair(cookie: string): string {
  return cookie.split(';')[0] ?? cookie;
}
