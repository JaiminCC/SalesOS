import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import type { Job } from 'bullmq';
import { createPrismaClient, importCrmBatch, qualifyCrmLead, runCrmDiscovery, withTenant } from '@salesos/database';
import { CRM_IMPORT_JOB, CRM_QUALIFY_JOB, type CrmJobData } from '@salesos/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { processCrmJob } from './processor';

const adminUrl = process.env.DATABASE_URL;
const workerUrl = process.env.DATABASE_URL_WORKER;
const encryptionKey = process.env.DATA_ENCRYPTION_KEY;

describe.skipIf(!adminUrl || !workerUrl || !encryptionKey)('crm process recovery', () => {
  const admin = createPrismaClient(adminUrl as string);
  const worker = createPrismaClient(workerUrl as string);
  const tenantId = randomUUID();
  const userId = randomUUID();

  beforeAll(async () => {
    await admin.tenant.create({ data: { id: tenantId, name: `Crash ${tenantId.slice(0, 8)}`, slug: `crash-${tenantId.slice(0, 8)}` } });
    await admin.user.create({ data: { id: userId, emailHmac: randomUUID(), emailCiphertext: Buffer.from([1]), displayName: 'Crash', status: 'ACTIVE' } });
    await admin.membership.create({ data: { tenantId, userId, status: 'ACTIVE' } });
    const role = await admin.role.create({ data: { tenantId, name: 'OWNER', isSystem: true } });
    for (const permission of ['crm.leads.import', 'crm.leads.discover', 'crm.leads.qualify']) {
      await admin.rolePermission.create({ data: { tenantId, roleId: role.id, permission } });
    }
    await admin.membershipRole.create({ data: { tenantId, userId, roleId: role.id } });
  });

  afterAll(async () => {
    await admin.tenant.delete({ where: { id: tenantId } }).catch(() => undefined);
    await admin.user.delete({ where: { id: userId } }).catch(() => undefined);
    await worker.$disconnect();
    await admin.$disconnect();
  });

  it('recovers a killed import without duplicating accounts', async () => {
    const batch = await importBatch(['https://alpha.example', 'https://beta.example']);
    await killAfterCheckpoint('import', tenantId, userId, batch.id);
    expect(await createdRows(batch.id)).toBe(1);
    await expect(processCrmJob(job(CRM_IMPORT_JOB, batch.id), worker, encryptionKey as string)).rejects.toThrow(/LEASE_HELD/);
    expect(await createdRows(batch.id)).toBe(1);
    await expire(batch.id);
    const finished = await importCrmBatch(worker, actor(), batch.id);
    expect(finished.held).toBeUndefined();
    expect(await createdRows(batch.id)).toBe(2);
    await importCrmBatch(worker, actor(), batch.id);
    expect(await createdRows(batch.id)).toBe(2);
    const stored = await admin.crmImportBatch.findUnique({ where: { tenantId_id: { tenantId, id: batch.id } } });
    expect(stored?.status).toBe('COMPLETED');
  });

  it('does not continue a cancelled, suspended, or unauthorized import', async () => {
    const cancelled = await importBatch(['https://cancel-a.example', 'https://cancel-b.example']);
    await killAfterCheckpoint('import', tenantId, userId, cancelled.id);
    await admin.crmImportBatch.update({ where: { tenantId_id: { tenantId, id: cancelled.id } }, data: { status: 'CANCELLED' } });
    await expire(cancelled.id);
    expect((await importCrmBatch(worker, actor(), cancelled.id)).stopped).toBe('cancelled');
    expect(await createdRows(cancelled.id)).toBe(1);

    const suspended = await importBatch(['https://suspend-a.example', 'https://suspend-b.example']);
    await killAfterCheckpoint('import', tenantId, userId, suspended.id);
    await expire(suspended.id);
    await admin.tenant.update({ where: { id: tenantId }, data: { status: 'SUSPENDED' } });
    expect((await importCrmBatch(worker, actor(), suspended.id)).stopped).toBe('suspended');
    expect(await createdRows(suspended.id)).toBe(1);
    await admin.tenant.update({ where: { id: tenantId }, data: { status: 'ACTIVE' } });

    const revoked = await importBatch(['https://revoke-a.example', 'https://revoke-b.example']);
    await killAfterCheckpoint('import', tenantId, userId, revoked.id);
    await expire(revoked.id);
    await admin.rolePermission.deleteMany({ where: { tenantId, permission: 'crm.leads.import' } });
    expect((await importCrmBatch(worker, actor(), revoked.id)).stopped).toBe('forbidden');
    expect(await createdRows(revoked.id)).toBe(1);
    const role = await admin.role.findFirstOrThrow({ where: { tenantId, name: 'OWNER' } });
    await admin.rolePermission.create({ data: { tenantId, roleId: role.id, permission: 'crm.leads.import' } });
    const resumed = await importCrmBatch(worker, actor(), revoked.id);
    expect(resumed.stopped).toBeUndefined();
    expect(await createdRows(revoked.id)).toBe(2);
  });

  it('recovers a killed discovery job without duplicating candidates', async () => {
    const discovery = await admin.crmDiscoveryJob.create({
      data: {
        tenantId,
        providerId: 'manual',
        status: 'QUEUED',
        createdBy: userId,
        criteria: { companies: [{ name: 'Alpha Freight', website: 'https://alpha-discovery.example' }, { name: 'Beta Freight', website: 'https://beta-discovery.example' }] },
      },
    });
    await killAfterCheckpoint('discovery', tenantId, userId, discovery.id);
    expect(await candidateCount(discovery.id)).toBe(1);
    expect((await runCrmDiscovery(worker, actor(), discovery.id)).held).toBe(true);
    expect(await candidateCount(discovery.id)).toBe(1);
    await expire(discovery.id);
    expect((await runCrmDiscovery(worker, actor(), discovery.id)).candidates).toBe(2);
    expect((await runCrmDiscovery(worker, actor(), discovery.id)).candidates).toBe(0);
    expect(await candidateCount(discovery.id)).toBe(2);
    const rows = await admin.crmDiscoveryCandidate.findMany({ where: { tenantId, jobId: discovery.id } });
    expect(rows.every((row) => row.live === false)).toBe(true);
  });

  it('recovers a killed qualification without a second history row', async () => {
    const account = await admin.crmAccount.create({ data: { tenantId, legalName: 'Qualified', displayName: 'Qualified', industry: 'Logistics', country: 'US', sizeRange: '51-200', description: 'Needs capture', createdBy: userId } });
    const product = await admin.product.create({ data: { tenantId, name: 'Field Kit', productType: 'PHYSICAL', createdBy: userId, updatedBy: userId } });
    const version = await admin.productVersion.create({
      data: {
        tenantId,
        productId: product.id,
        versionNumber: 1,
        status: 'PUBLISHED',
        snapshot: { icps: [{ id: randomUUID(), name: 'Field operators', priority: 1, industries: ['Logistics'], countries: ['US'], companySizes: ['51-200'] }] },
        createdBy: userId,
        updatedBy: userId,
      },
    });
    const lead = await admin.crmLead.create({ data: { tenantId, accountId: account.id, productId: product.id, productVersionId: version.id, sourceType: 'manual', createdBy: userId } });
    await killAfterCheckpoint('qualify', tenantId, userId, lead.id);
    expect(await qualificationCount(lead.id)).toBe(0);
    await expect(processCrmJob(job(CRM_QUALIFY_JOB, lead.id), worker, encryptionKey as string)).rejects.toThrow(/LEASE_HELD/);
    expect(await qualificationCount(lead.id)).toBe(0);
    await expire(lead.id);
    const first = await qualifyCrmLead(worker, { ...actor(), runId: lead.id }, lead.id);
    expect(first.score).toBe(65);
    const second = await qualifyCrmLead(worker, { ...actor(), runId: lead.id }, lead.id);
    expect(second.score).toBe(65);
    expect(await qualificationCount(lead.id)).toBe(1);
    await admin.crmWorkLease.update({ where: { tenantId_kind_recordId: { tenantId, kind: 'qualify', recordId: lead.id } }, data: { status: 'CANCELLED' } });
    const another = await admin.crmLead.create({ data: { tenantId, accountId: account.id, sourceType: 'manual', createdBy: userId } });
    await withTenant(worker, tenantId, (tx) => tx.crmWorkLease.create({ data: { tenantId, kind: 'qualify', recordId: another.id, status: 'CANCELLED' } }));
    expect((await qualifyCrmLead(worker, actor(), another.id)).stopped).toBe('cancelled');
    expect(await qualificationCount(another.id)).toBe(0);
  });

  function actor() {
    return { tenantId, userId, key: Buffer.alloc(32) };
  }

  function job(name: string, recordId: string): Job<CrmJobData> {
    return { name, data: { tenantId, recordId, outboxId: randomUUID() } } as Job<CrmJobData>;
  }

  async function importBatch(websites: string[]) {
    return admin.crmImportBatch.create({
      data: {
        tenantId,
        status: 'QUEUED',
        fileName: 'crash.csv',
        idempotencyKey: randomUUID(),
        rowCount: websites.length,
        createdBy: userId,
        rows: { create: websites.map((website, index) => ({ rowNumber: index + 1, status: 'PENDING', payload: { companyName: `Freight ${index}`, website, industry: 'Logistics', country: 'US' } })) },
      },
    });
  }

  async function createdRows(batchId: string) {
    return admin.crmImportRow.count({ where: { tenantId, batchId, status: 'CREATED' } });
  }

  async function candidateCount(jobId: string) {
    return admin.crmDiscoveryCandidate.count({ where: { tenantId, jobId } });
  }

  async function qualificationCount(leadId: string) {
    return admin.crmQualification.count({ where: { tenantId, leadId } });
  }

  async function expire(recordId: string) {
    await admin.$executeRaw`UPDATE public.crm_work_leases SET lease_until = pg_catalog.now() - interval '1 second' WHERE tenant_id = ${tenantId}::uuid AND record_id = ${recordId}::uuid`;
  }
});

function killAfterCheckpoint(kind: string, tenantId: string, userId: string, recordId: string): Promise<void> {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, ['--import', 'tsx', resolve(process.cwd(), 'src/crm-crash.ts'), kind, tenantId, recordId], {
      cwd: process.cwd(),
      env: { ...process.env, SALESOS_CRM_USER: userId },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    let seen = false;
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      fail(new Error(output || 'checkpoint timed out'));
    }, 20000);
    child.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      if (!seen && output.includes('checkpoint')) {
        seen = true;
        clearTimeout(timer);
        child.kill('SIGKILL');
      }
    });
    child.stderr?.on('data', (chunk: Buffer) => { output += chunk.toString(); });
    child.on('close', () => {
      if (seen) done();
      else fail(new Error(output || 'worker exited before the checkpoint'));
    });
  });
}
