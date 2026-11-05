import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { createPrismaClient } from './client';
import './load-env';

const adminUrl = process.env.DATABASE_URL;
const appUrl = process.env.DATABASE_URL_APP;

describe.skipIf(!adminUrl || !appUrl)('assignment locking', () => {
  const admin = createPrismaClient(adminUrl as string);

  afterAll(async () => {
    await admin.$disconnect();
  });

  it('blocks membership removal until the assignment transaction commits, then ends ownership', async () => {
    const world = await seed();
    const app = await begin(world.tenantId);
    try {
      expect((await app.query<{ ok: boolean }>('SELECT public.lock_member_for_assignment($1::uuid, $2::uuid) AS ok', [world.tenantId, world.userId])).rows[0]?.ok).toBe(true);
      const removal = removalUpdate(world.tenantId, world.userId, 'REMOVED');
      await expectBlocked(removal);
      await app.query('UPDATE public.crm_leads SET owner_user_id = $1::uuid WHERE id = $2::uuid', [world.userId, world.leadId]);
      await app.query('COMMIT');
      await removal.done;
      await expectCleared(world.tenantId, world.leadId);
    } finally {
      await app.end();
    }
  });

  it('blocks membership suspension until the assignment transaction commits', async () => {
    const world = await seed();
    const app = await begin(world.tenantId);
    try {
      expect((await app.query<{ ok: boolean }>('SELECT public.lock_member_for_assignment($1::uuid, $2::uuid) AS ok', [world.tenantId, world.userId])).rows[0]?.ok).toBe(true);
      const removal = removalUpdate(world.tenantId, world.userId, 'SUSPENDED');
      await expectBlocked(removal);
      await app.query('COMMIT');
      await removal.done;
      await expectCleared(world.tenantId, world.leadId);
    } finally {
      await app.end();
    }
  });

  it('blocks organization suspension until the assignment transaction commits', async () => {
    const world = await seed();
    const app = await begin(world.tenantId);
    try {
      expect((await app.query<{ ok: boolean }>('SELECT public.lock_member_for_assignment($1::uuid, $2::uuid) AS ok', [world.tenantId, world.userId])).rows[0]?.ok).toBe(true);
      const suspension = tracked(admin.$executeRaw`UPDATE public.tenants SET status = 'SUSPENDED' WHERE id = ${world.tenantId}::uuid`);
      await expectBlocked(suspension);
      await app.query('UPDATE public.crm_leads SET owner_user_id = $1::uuid WHERE id = $2::uuid', [world.userId, world.leadId]);
      await app.query('COMMIT');
      await suspension.done;
      await expectCleared(world.tenantId, world.leadId);
    } finally {
      await app.end();
    }
  });

  it('clears every lead from a bulk assignment when the member is removed', async () => {
    const world = await seed();
    const app = await begin(world.tenantId);
    try {
      expect((await app.query<{ ok: boolean }>('SELECT public.lock_member_for_assignment($1::uuid, $2::uuid) AS ok', [world.tenantId, world.userId])).rows[0]?.ok).toBe(true);
      await app.query('UPDATE public.crm_leads SET owner_user_id = $1::uuid WHERE id = ANY($2::uuid[])', [world.userId, [world.leadId, world.secondId]]);
      await app.query(
        `INSERT INTO public.crm_assignments (tenant_id, subject_type, subject_id, owner_user_id, reason, actor_id)
         VALUES ($1::uuid, 'lead', $2::uuid, $3::uuid, 'Bulk', $3::uuid)`,
        [world.tenantId, world.secondId, world.userId],
      );
      const removal = removalUpdate(world.tenantId, world.userId, 'REMOVED');
      await expectBlocked(removal);
      await app.query('COMMIT');
      await removal.done;
      const leads = await admin.crmLead.findMany({ where: { tenantId: world.tenantId } });
      expect(leads.every((lead) => lead.ownerUserId === null)).toBe(true);
      const open = await admin.crmAssignment.count({ where: { tenantId: world.tenantId, endedAt: null, ownerUserId: world.userId } });
      expect(open).toBe(0);
      const takeover = await admin.crmTakeover.findFirst({ where: { tenantId: world.tenantId, subjectId: world.leadId } });
      expect(takeover?.active).toBe(true);
    } finally {
      await app.end();
    }
  });

  it('refuses assignment after the member is already removed', async () => {
    const world = await seed();
    await admin.membership.update({ where: { tenantId_userId: { tenantId: world.tenantId, userId: world.userId } }, data: { status: 'REMOVED' } });
    const app = await begin(world.tenantId);
    try {
      expect((await app.query<{ ok: boolean }>('SELECT public.lock_member_for_assignment($1::uuid, $2::uuid) AS ok', [world.tenantId, world.userId])).rows[0]?.ok).toBe(false);
      await app.query('ROLLBACK');
      const lead = await admin.crmLead.findUnique({ where: { tenantId_id: { tenantId: world.tenantId, id: world.leadId } } });
      expect(lead?.ownerUserId).toBeNull();
    } finally {
      await app.end();
    }
  });

  async function seed() {
    const tenantId = randomUUID();
    const ownerId = randomUUID();
    const userId = randomUUID();
    await admin.tenant.create({ data: { id: tenantId, name: `Lock ${tenantId.slice(0, 8)}`, slug: `lock-${tenantId.slice(0, 8)}` } });
    for (const id of [ownerId, userId]) {
      await admin.user.create({ data: { id, emailHmac: randomUUID(), emailCiphertext: Buffer.from([1]), displayName: 'Member', status: 'ACTIVE' } });
      await admin.membership.create({ data: { tenantId, userId: id, status: 'ACTIVE' } });
    }
    const account = await admin.crmAccount.create({ data: { tenantId, legalName: 'Harbor', displayName: 'Harbor', createdBy: ownerId } });
    const lead = await admin.crmLead.create({ data: { tenantId, accountId: account.id, sourceType: 'manual', ownerUserId: userId, createdBy: ownerId } });
    const second = await admin.crmLead.create({ data: { tenantId, accountId: account.id, sourceType: 'manual', createdBy: ownerId } });
    await admin.crmAssignment.create({ data: { tenantId, subjectType: 'lead', subjectId: lead.id, ownerUserId: userId, reason: 'Open', actorId: ownerId } });
    await admin.crmTakeover.create({ data: { tenantId, subjectType: 'lead', subjectId: lead.id, reason: 'Human takeover', actorId: ownerId } });
    return { tenantId, userId, leadId: lead.id, secondId: second.id };
  }

  async function begin(tenantId: string) {
    const app = new Client({ connectionString: appUrl });
    await app.connect();
    await app.query('BEGIN');
    await app.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
    await app.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [tenantId]);
    return app;
  }

  function removalUpdate(tenantId: string, userId: string, status: string) {
    return tracked(admin.$executeRaw`UPDATE public.memberships SET status = ${status} WHERE tenant_id = ${tenantId}::uuid AND user_id = ${userId}::uuid`);
  }

  async function expectCleared(tenantId: string, leadId: string) {
    const lead = await admin.crmLead.findUnique({ where: { tenantId_id: { tenantId, id: leadId } } });
    expect(lead?.ownerUserId).toBeNull();
    const assignment = await admin.crmAssignment.findFirst({ where: { tenantId, subjectId: leadId, reason: 'Open' } });
    expect(assignment?.endedAt).toBeTruthy();
    const takeover = await admin.crmTakeover.findFirst({ where: { tenantId, subjectId: leadId } });
    expect(takeover?.active).toBe(true);
    expect(takeover?.endedAt).toBeNull();
  }
});

function tracked(done: Promise<unknown>) {
  let settled = false;
  const wrapped = done.then((value) => {
    settled = true;
    return value;
  });
  return { done: wrapped, settled: () => settled };
}

async function expectBlocked(operation: { settled: () => boolean }): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 300));
  expect(operation.settled()).toBe(false);
}
