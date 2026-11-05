import { randomUUID } from 'node:crypto';
import { LlmSchemaError } from '@salesos/agent-core';
import { createPrismaClient, executeAgentRun, withTenant } from '@salesos/database';
import { AGENT_RUN_EVENT, AGENT_RUN_JOB } from '@salesos/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { markFinalFailure } from './processor';

const adminUrl = process.env.DATABASE_URL;
const workerUrl = process.env.DATABASE_URL_WORKER;

describe.skipIf(!adminUrl || !workerUrl)('agent run execution', () => {
  const admin = createPrismaClient(adminUrl as string);
  const prisma = createPrismaClient(workerUrl as string);
  const tenantId = randomUUID();

  afterAll(async () => {
    await prisma.$disconnect();
    await admin.$disconnect();
  });

  it('keeps one action when the same run is delivered twice', async () => {
    await admin.tenant.create({ data: { id: tenantId, name: `Agent ${tenantId.slice(0, 8)}`, slug: `agent-${tenantId.slice(0, 8)}` } });
    const runId = randomUUID();
    await withTenant(prisma, tenantId, (tx) => tx.agentRun.create({
      data: { tenantId, id: runId, triggerType: 'TEST', state: 'QUEUED', createdBy: randomUUID(), inputRedacted: { note: 'ada@example.com' } },
    }));
    const deps = {
      generate: async () => ({ result: { actionType: 'NO_ACTION', external: false, summary: 'internal', commercialCommitment: false }, provider: 'fake', model: 'fake-1', inputTokens: 1, outputTokens: 1 }),
      sendExternal: async () => undefined,
    };
    expect((await executeAgentRun(prisma, tenantId, runId, deps)).state).toBe('SUCCEEDED');
    expect((await executeAgentRun(prisma, tenantId, runId, deps)).state).toBe('SUCCEEDED');
    const actions = await withTenant(prisma, tenantId, (tx) => tx.agentAction.count({ where: { tenantId, runId } }));
    expect(actions).toBe(1);
    const stored = await withTenant(prisma, tenantId, (tx) => tx.agentRun.findUnique({ where: { tenantId_id: { tenantId, id: runId } } }));
    expect(JSON.stringify(stored?.inputRedacted)).toContain('[email]');
    expect(JSON.stringify(stored?.inputRedacted)).not.toContain('ada@example.com');
  });

  it('does not send while automation is paused and records provider failure without a send', async () => {
    await admin.tenant.update({ where: { id: tenantId }, data: { automationStatus: 'PAUSED' } });
    const pausedId = randomUUID();
    const actionId = randomUUID();
    let sent = 0;
    await withTenant(prisma, tenantId, async (tx) => {
      await tx.agentRun.create({ data: { tenantId, id: pausedId, triggerType: 'SCAN', state: 'QUEUED', createdBy: randomUUID() } });
      await tx.agentAction.create({
        data: { tenantId, runId: pausedId, id: actionId, actionType: 'SEND_EMAIL', targetType: 'organization', state: 'READY', idempotencyKey: `${pausedId}:proposal` },
      });
    });
    const paused = await executeAgentRun(prisma, tenantId, pausedId, { generate: async () => { throw new Error('unused'); }, sendExternal: async () => { sent += 1; } });
    expect(paused.state).toBe('PAUSED');
    expect(sent).toBe(0);

    await admin.tenant.update({ where: { id: tenantId }, data: { automationStatus: 'RUNNING' } });
    const failedId = randomUUID();
    await withTenant(prisma, tenantId, async (tx) => {
      await tx.agentRun.create({ data: { tenantId, id: failedId, triggerType: 'SCAN', state: 'QUEUED', createdBy: randomUUID() } });
      await tx.agentAction.create({
        data: { tenantId, runId: failedId, actionType: 'SEND_EMAIL', targetType: 'organization', state: 'READY', idempotencyKey: `${failedId}:proposal` },
      });
    });
    const failed = await executeAgentRun(prisma, tenantId, failedId, {
      generate: async () => { throw new Error('unused'); },
      sendExternal: async () => { throw Object.assign(new Error('unavailable'), { status: 503 }); },
    });
    expect(failed.state).toBe('FAILED_RETRYABLE');
    const action = await withTenant(prisma, tenantId, (tx) => tx.agentAction.findFirst({ where: { tenantId, runId: failedId } }));
    expect(action?.outcome).toEqual({ sent: false });
  });

  it('escalates a second invalid model payload and does not rewrite an old policy version', async () => {
    const runId = randomUUID();
    await withTenant(prisma, tenantId, async (tx) => {
      const policy = await tx.automationPolicy.create({ data: { tenantId, name: 'Outbound', autonomyLevel: 'A4', version: 1 } });
      await tx.agentRun.create({ data: { tenantId, id: runId, triggerType: 'SCAN', state: 'QUEUED', createdBy: randomUUID() } });
      await tx.agentAction.create({
        data: { tenantId, runId, actionType: 'NO_ACTION', targetType: 'organization', state: 'SUCCEEDED', policyVersion: '1', idempotencyKey: `${runId}:old` },
      });
      await tx.automationPolicy.update({ where: { tenantId_id: { tenantId, id: policy.id } }, data: { version: 2 } });
    });
    const brokenId = randomUUID();
    await withTenant(prisma, tenantId, (tx) => tx.agentRun.create({ data: { tenantId, id: brokenId, triggerType: 'SCAN', state: 'QUEUED', createdBy: randomUUID() } }));
    const result = await executeAgentRun(prisma, tenantId, brokenId, {
      generate: async () => { throw new LlmSchemaError(); },
      sendExternal: async () => undefined,
    });
    expect(result.state).toBe('FAILED_FINAL');
    const historical = await withTenant(prisma, tenantId, (tx) => tx.agentAction.findFirst({ where: { tenantId, idempotencyKey: `${runId}:old` } }));
    expect(historical?.policyVersion).toBe('1');
  });

  it('records an exhausted agent job as failed instead of leaving the run queued', async () => {
    const runId = randomUUID();
    const outboxId = randomUUID();
    await withTenant(prisma, tenantId, async (tx) => {
      await tx.agentRun.create({ data: { tenantId, id: runId, triggerType: 'SCAN', state: 'QUEUED', createdBy: randomUUID() } });
      await tx.outboxEvent.create({
        data: { tenantId, id: outboxId, eventType: AGENT_RUN_EVENT, aggregateId: runId, payload: { runId } },
      });
    });
    const job = { name: AGENT_RUN_JOB, attemptsMade: 1, opts: { attempts: 5 }, data: { tenantId, runId, outboxId } };
    await markFinalFailure(job as never, prisma);
    const stillQueued = await withTenant(prisma, tenantId, (tx) => tx.agentRun.findUnique({ where: { tenantId_id: { tenantId, id: runId } } }));
    expect(stillQueued?.state).toBe('QUEUED');
    await markFinalFailure({ ...job, attemptsMade: 5 } as never, prisma);
    const failed = await withTenant(prisma, tenantId, (tx) => tx.agentRun.findUnique({ where: { tenantId_id: { tenantId, id: runId } } }));
    const outbox = await withTenant(prisma, tenantId, (tx) => tx.outboxEvent.findUnique({ where: { tenantId_id: { tenantId, id: outboxId } } }));
    expect(failed?.state).toBe('FAILED_FINAL');
    expect(failed?.errorCode).toBe('EXHAUSTED');
    expect(outbox?.status).toBe('FAILED');
  });
});
