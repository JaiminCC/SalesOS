import type { Prisma, PrismaClient } from '@prisma/client';
import { POLICY_VERSION, budgetStop, decide, redactValue, textHasCommercialCommitment } from '@salesos/shared';
import { withTenant } from './with-tenant';

export type AgentProposal = {
  actionType: string;
  external: boolean;
  summary: string;
  commercialCommitment: boolean;
};

export type AgentGenerator = () => Promise<{
  result: AgentProposal;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}>;

const TERMINAL_RUN = new Set(['SUCCEEDED', 'FAILED_FINAL', 'CANCELLED', 'WAITING_APPROVAL']);
const TERMINAL_ACTION = new Set(['SUCCEEDED', 'BLOCKED', 'NEEDS_APPROVAL', 'CANCELLED', 'FAILED_FINAL']);

export async function executeAgentRun(
  prisma: PrismaClient,
  tenantId: string,
  runId: string,
  deps: { generate: AgentGenerator; sendExternal: (actionId: string) => Promise<void>; outboxId?: string },
): Promise<{ state: string }> {
  return withTenant(prisma, tenantId, async (tx) => {
    const run = await tx.agentRun.findUnique({ where: { tenantId_id: { tenantId, id: runId } } });
    if (!run) throw new Error('agent run is missing');
    if (run.archivedAt || TERMINAL_RUN.has(run.state)) return { state: run.state };
    if (run.state === 'PAUSED') return { state: 'PAUSED' };

    const existing = await tx.agentAction.findFirst({ where: { tenantId, runId, idempotencyKey: `${runId}:proposal` } });
    if (existing && TERMINAL_ACTION.has(existing.state)) {
      const state = existing.state === 'NEEDS_APPROVAL' ? 'WAITING_APPROVAL' : existing.state === 'BLOCKED' ? 'SUCCEEDED' : existing.state;
      await tx.agentRun.update({ where: { tenantId_id: { tenantId, id: runId } }, data: { state, finishedAt: run.finishedAt ?? new Date() } });
      await markOutbox(tx, tenantId, deps.outboxId);
      return { state };
    }
    if (existing && (existing.state === 'READY' || existing.state === 'PAUSED')) {
      return finishExternal(tx, tenantId, runId, existing.id, deps);
    }

    const tenant = await automationSettings(tx, tenantId);
    await tx.agentRun.update({
      where: { tenantId_id: { tenantId, id: runId } },
      data: { state: 'RUNNING', startedAt: run.startedAt ?? new Date(), inputRedacted: redactValue(run.inputRedacted) as Prisma.InputJsonValue },
    });
    await addStep(tx, tenantId, runId, 'load', 'SUCCEEDED', { triggerType: run.triggerType });

    const month = new Date();
    month.setUTCDate(1);
    month.setUTCHours(0, 0, 0, 0);
    const usage = await tx.llmUsage.aggregate({ where: { tenantId, createdAt: { gte: month } }, _sum: { costMinor: true } });
    if (budgetStop(usage._sum.costMinor ?? 0, tenant.llm_monthly_budget_minor)) {
      await addStep(tx, tenantId, runId, 'budget', 'FAILED_FINAL', { reason: 'BUDGET' });
      await escalate(tx, tenantId, runId, 'BUDGET');
      await closeRun(tx, tenantId, runId, 'FAILED_FINAL', 'BUDGET');
      await markOutbox(tx, tenantId, deps.outboxId);
      return { state: 'FAILED_FINAL' };
    }

    let proposal: AgentProposal;
    let provider = 'fake';
    let model = 'fake-1';
    let inputTokens = 0;
    let outputTokens = 0;
    try {
      const generated = await deps.generate();
      proposal = generated.result;
      provider = generated.provider;
      model = generated.model;
      inputTokens = generated.inputTokens;
      outputTokens = generated.outputTokens;
    } catch (error) {
      const schema = error instanceof Error && (error.name === 'LlmSchemaError' || error.message.includes('does not match the schema'));
      if (!schema) throw error;
      await addStep(tx, tenantId, runId, 'model', 'FAILED_FINAL', { reason: 'SCHEMA' });
      await escalate(tx, tenantId, runId, 'SCHEMA');
      await closeRun(tx, tenantId, runId, 'FAILED_FINAL', 'SCHEMA');
      await markOutbox(tx, tenantId, deps.outboxId);
      return { state: 'FAILED_FINAL' };
    }

    await tx.llmUsage.create({
      data: { tenantId, runId, provider, model, inputTokens, outputTokens, costMinor: inputTokens + outputTokens, currency: 'USD' },
    });
    await tx.agentRun.update({ where: { tenantId_id: { tenantId, id: runId } }, data: { modelProvider: provider, modelName: model, promptVersion: POLICY_VERSION } });
    const policy = await tx.automationPolicy.findFirst({ where: { tenantId, status: 'ACTIVE' }, orderBy: { version: 'desc' } });
    const policyVersion = policy ? String(policy.version) : POLICY_VERSION;
    const summary = String(redactValue(proposal.summary));
    const external = proposal.external;
    const result = decide({
      actionType: proposal.actionType,
      external,
      firstOutbound: external && (proposal.actionType === 'SEND_EMAIL' || proposal.actionType === 'DRAFT_MESSAGE'),
      commercialCommitment: proposal.commercialCommitment || textHasCommercialCommitment(summary),
    }, {
      autonomyLevel: (policy?.autonomyLevel as 'A0' | 'A1' | 'A2' | 'A3' | 'A4') || 'A4',
      suppressed: false,
      humanOwned: false,
      killSwitch: tenant.automation_status === 'PAUSED',
    }, policyVersion);
    const action = await tx.agentAction.create({
      data: {
        tenantId,
        runId,
        actionType: proposal.actionType,
        targetType: 'organization',
        riskLevel: external ? 'HIGH' : 'LOW',
        policyVersion: result.policyVersion,
        policyDecision: result.decision,
        state: 'POLICY_CHECKED',
        requiresHumanApproval: result.decision !== 'ALLOW',
        idempotencyKey: `${runId}:proposal`,
        payload: redactValue({ summary, reason: result.reason }) as Prisma.InputJsonValue,
      },
    });
    await addStep(tx, tenantId, runId, 'policy', 'SUCCEEDED', { decision: result.decision, reason: result.reason, policyVersion: result.policyVersion });

    if (result.decision === 'BLOCK') {
      await tx.agentAction.update({ where: { tenantId_id: { tenantId, id: action.id } }, data: { state: 'BLOCKED', outcome: { sent: false } } });
      await closeRun(tx, tenantId, runId, 'SUCCEEDED', null);
      await markOutbox(tx, tenantId, deps.outboxId);
      return { state: 'SUCCEEDED' };
    }
    if (result.decision === 'REQUIRE_APPROVAL') {
      await tx.agentAction.update({ where: { tenantId_id: { tenantId, id: action.id } }, data: { state: 'NEEDS_APPROVAL', outcome: { sent: false } } });
      await closeRun(tx, tenantId, runId, 'WAITING_APPROVAL', null);
      await markOutbox(tx, tenantId, deps.outboxId);
      return { state: 'WAITING_APPROVAL' };
    }
    if (!external) {
      await tx.agentAction.update({ where: { tenantId_id: { tenantId, id: action.id } }, data: { state: 'SUCCEEDED', outcome: { sent: false } } });
      await addStep(tx, tenantId, runId, 'execute', 'SUCCEEDED', { sent: false });
      await closeRun(tx, tenantId, runId, 'SUCCEEDED', null);
      await markOutbox(tx, tenantId, deps.outboxId);
      return { state: 'SUCCEEDED' };
    }
    await tx.agentAction.update({ where: { tenantId_id: { tenantId, id: action.id } }, data: { state: 'READY' } });
    return finishExternal(tx, tenantId, runId, action.id, deps);
  });
}

async function finishExternal(
  tx: Prisma.TransactionClient,
  tenantId: string,
  runId: string,
  actionId: string,
  deps: { sendExternal: (actionId: string) => Promise<void>; outboxId?: string },
): Promise<{ state: string }> {
  const tenant = await automationSettings(tx, tenantId);
  if (tenant.automation_status === 'PAUSED') {
    await tx.agentAction.update({ where: { tenantId_id: { tenantId, id: actionId } }, data: { state: 'PAUSED', outcome: { sent: false } } });
    await tx.agentRun.update({ where: { tenantId_id: { tenantId, id: runId } }, data: { state: 'PAUSED' } });
    await addStep(tx, tenantId, runId, 'execute', 'PAUSED', { sent: false });
    return { state: 'PAUSED' };
  }
  try {
    await deps.sendExternal(actionId);
  } catch (error) {
    const status = typeof error === 'object' && error && 'status' in error ? Number((error as { status: number }).status) : 0;
    if (status !== 503) throw error;
    const current = await tx.agentAction.findUnique({ where: { tenantId_id: { tenantId, id: actionId } } });
    await tx.agentAction.update({
      where: { tenantId_id: { tenantId, id: actionId } },
      data: { state: 'FAILED_RETRYABLE', attempts: (current?.attempts ?? 0) + 1, outcome: { sent: false } },
    });
    await closeRun(tx, tenantId, runId, 'FAILED_RETRYABLE', 'PROVIDER');
    await markOutbox(tx, tenantId, deps.outboxId);
    return { state: 'FAILED_RETRYABLE' };
  }
  await tx.agentAction.update({ where: { tenantId_id: { tenantId, id: actionId } }, data: { state: 'SUCCEEDED', outcome: { sent: true } } });
  await addStep(tx, tenantId, runId, 'execute', 'SUCCEEDED', { sent: true });
  await closeRun(tx, tenantId, runId, 'SUCCEEDED', null);
  await markOutbox(tx, tenantId, deps.outboxId);
  return { state: 'SUCCEEDED' };
}

async function escalate(tx: Prisma.TransactionClient, tenantId: string, runId: string, reason: string): Promise<void> {
  await tx.agentAction.create({
    data: {
      tenantId,
      runId,
      actionType: 'ESCALATE',
      targetType: 'organization',
      state: 'SUCCEEDED',
      requiresHumanApproval: false,
      idempotencyKey: `${runId}:${reason}`,
      payload: { reason },
      outcome: { sent: false },
    },
  });
}

async function addStep(tx: Prisma.TransactionClient, tenantId: string, runId: string, name: string, status: string, detail: Record<string, unknown>): Promise<void> {
  const count = await tx.agentRunStep.count({ where: { tenantId, runId } });
  await tx.agentRunStep.create({
    data: { tenantId, runId, position: count + 1, name, status, detailRedacted: redactValue(detail) as Prisma.InputJsonValue },
  });
}

async function closeRun(tx: Prisma.TransactionClient, tenantId: string, runId: string, state: string, errorCode: string | null): Promise<void> {
  await tx.agentRun.update({ where: { tenantId_id: { tenantId, id: runId } }, data: { state, errorCode, finishedAt: new Date() } });
}

async function automationSettings(tx: Prisma.TransactionClient, tenantId: string): Promise<{ automation_status: string; llm_monthly_budget_minor: number; llm_provider: string }> {
  const rows = await tx.$queryRaw<Array<{ automation_status: string; llm_monthly_budget_minor: number; llm_provider: string }>>`
    SELECT automation_status, llm_monthly_budget_minor, llm_provider
    FROM public.read_automation_settings(${tenantId}::uuid)
  `;
  const row = rows[0];
  if (!row) throw new Error('organization is missing');
  return row;
}

async function markOutbox(tx: Prisma.TransactionClient, tenantId: string, outboxId?: string): Promise<void> {
  if (!outboxId) return;
  await tx.outboxEvent.updateMany({ where: { tenantId, id: outboxId, status: 'PENDING' }, data: { status: 'PROCESSED', processedAt: new Date() } });
}
