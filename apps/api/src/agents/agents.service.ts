import { Inject, Injectable } from '@nestjs/common';
import { createModelClient } from '@salesos/agent-core';
import { ContextError, Prisma, advanceAgentRun, decodeEncryptionKey, encryptField, loadPublishedContext, readModelSelection, withTenant } from '@salesos/database';
import { AGENT_RUN_EVENT, DEFAULT_RUN_LIMITS, buildSupervisorPlan, decide, redactValue, textHasCommercialCommitment, validatePlan } from '@salesos/shared';
import { ApiException } from '../common/api.exception';
import { runBatch } from '../common/batch';
import { AppConfig } from '../config/app-config';
import { DatabaseService } from '../database/database.service';
import type { SessionContext } from '../identity/identity.service';
import type { AgentChangeDto, AgentCreateDto, AgentPageDto, ApprovalDecisionDto, ModelChangeDto, ModelCreateDto, PolicyChangeDto, PolicyCreateDto, RunCreateDto } from './agents.dto';

const AGENT_SORT = new Set(['name', 'status', 'createdAt']);
const RUN_SORT = new Set(['createdAt', 'state', 'triggerType']);
const POLICY_SORT = new Set(['name', 'version', 'createdAt']);

@Injectable()
export class AgentsService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AppConfig) private readonly config: AppConfig,
  ) {}

  agentDirectory(actor: SessionContext, query: AgentPageDto) {
    return this.directory(actor, 'agent', query, AGENT_SORT);
  }

  async agentRecord(actor: SessionContext, id: string) {
    const tenantId = this.tenant(actor);
    const row = await withTenant(this.database.prisma, tenantId, (tx) => tx.agentProfile.findUnique({ where: { tenantId_id: { tenantId, id } } }));
    if (!row) throw new ApiException(404, 'NOT_FOUND', 'Agent was not found');
    return publicAgent(row);
  }

  async createAgent(actor: SessionContext, input: AgentCreateDto, requestId: string) {
    this.require(actor, 'agents.manage');
    const tenantId = this.tenant(actor);
    const row = await withTenant(this.database.prisma, tenantId, async (tx) => {
      const created = await tx.agentProfile.create({
        data: { tenantId, name: input.name.trim(), role: input.role.trim(), instructions: input.instructions?.trim() ?? '', modelConfigurationId: input.modelConfigurationId, defaultProductId: input.defaultProductId, createdBy: actor.userId },
      });
      await this.audit(tx, tenantId, actor.userId, 'agent.create', 'agent', created.id, requestId);
      return created;
    });
    return publicAgent(row);
  }

  async updateAgent(actor: SessionContext, input: AgentChangeDto, requestId: string) {
    this.require(actor, 'agents.manage');
    const tenantId = this.tenant(actor);
    const row = await withTenant(this.database.prisma, tenantId, async (tx) => {
      const current = await tx.agentProfile.findUnique({ where: { tenantId_id: { tenantId, id: input.id } } });
      if (!current || current.status === 'ARCHIVED') throw new ApiException(404, 'NOT_FOUND', 'Agent was not found');
      const updated = await tx.agentProfile.update({
        where: { tenantId_id: { tenantId, id: input.id } },
        data: { name: input.name.trim(), role: input.role.trim(), instructions: input.instructions?.trim() ?? '', enabled: input.enabled ?? current.enabled, modelConfigurationId: input.modelConfigurationId ?? current.modelConfigurationId, defaultProductId: input.defaultProductId ?? current.defaultProductId },
      });
      await this.audit(tx, tenantId, actor.userId, 'agent.update', 'agent', updated.id, requestId);
      return updated;
    });
    return publicAgent(row);
  }

  pauseAgent(actor: SessionContext, id: string, requestId: string) {
    return this.setAgentStatus(actor, id, 'PAUSED', false, requestId);
  }

  resumeAgent(actor: SessionContext, id: string, requestId: string) {
    return this.setAgentStatus(actor, id, 'ACTIVE', true, requestId);
  }

  archiveAgent(actor: SessionContext, id: string, requestId: string) {
    return this.setAgentStatus(actor, id, 'ARCHIVED', false, requestId);
  }

  bulkPauseAgents(actor: SessionContext, ids: string[], requestId: string) {
    return runBatch(ids, (id) => this.pauseAgent(actor, id, requestId));
  }

  bulkArchiveAgents(actor: SessionContext, ids: string[], requestId: string) {
    return runBatch(ids, (id) => this.archiveAgent(actor, id, requestId));
  }

  runDirectory(actor: SessionContext, query: AgentPageDto) {
    return this.directory(actor, 'run', query, RUN_SORT);
  }

  async runRecord(actor: SessionContext, id: string) {
    const tenantId = this.tenant(actor);
    const row = await withTenant(this.database.prisma, tenantId, async (tx) => {
      const run = await tx.agentRun.findUnique({ where: { tenantId_id: { tenantId, id } } });
      if (!run) return null;
      const steps = await tx.agentRunStep.findMany({ where: { tenantId, runId: id }, orderBy: { position: 'asc' } });
      const actions = await tx.agentAction.findMany({ where: { tenantId, runId: id }, orderBy: { createdAt: 'asc' } });
      const tools = await tx.agentToolCall.findMany({ where: { tenantId, runId: id }, orderBy: { createdAt: 'asc' } });
      const usage = await tx.llmUsage.findMany({ where: { tenantId, runId: id }, orderBy: { createdAt: 'asc' } });
      return { run, steps, actions, tools, usage };
    });
    if (!row) throw new ApiException(404, 'NOT_FOUND', 'Run was not found');
    return { ...publicRun(row.run), steps: row.steps.map(publicStep), actions: row.actions.map(publicAction), tools: row.tools.map(publicTool), usage: row.usage.map(publicUsage) };
  }

  async createRun(actor: SessionContext, input: RunCreateDto, requestId: string) {
    this.require(actor, 'agents.manage');
    const tenantId = this.tenant(actor);
    if (!input.goal?.trim() || !input.productId) throw new ApiException(422, 'MODEL_REQUIRED', 'A goal and a published product are required');
    const created = await withTenant(this.database.prisma, tenantId, async (tx) => {
      const agent = await this.ensureAgent(tx, tenantId, actor.userId, input.agentId);
      const modelId = input.modelConfigurationId || agent.modelConfigurationId;
      if (!modelId) throw new ApiException(422, 'MODEL_REQUIRED', 'Select a model configuration before starting a run');
      const model = await tx.modelConfiguration.findUnique({ where: { tenantId_id: { tenantId, id: modelId } } });
      if (!model?.enabled) throw new ApiException(422, 'MODEL_REQUIRED', 'The selected model is disabled');
      const active = await tx.agentRun.count({ where: { tenantId, state: { in: ['QUEUED', 'RUNNING'] } } });
      if (active >= DEFAULT_RUN_LIMITS.maxActiveRuns) throw new ApiException(429, 'LIMIT_ACTIVE_RUNS', 'This organization has too many active runs');
      let pinned;
      try {
        pinned = await loadPublishedContext(tx, tenantId, input.productId!, input.productVersionId);
      } catch (error) {
        if (error instanceof ContextError) throw new ApiException(error.status, error.status === 409 ? 'VERSION_NOT_PUBLISHED' : 'NOT_FOUND', error.message);
        throw error;
      }
      const plan = buildSupervisorPlan(input.goal!.trim());
      const invalid = validatePlan(plan);
      if (invalid) throw new ApiException(400, 'INVALID_PLAN', invalid);
      const run = await tx.agentRun.create({
        data: {
          tenantId,
          agentId: agent.id,
          triggerType: input.triggerType,
          state: 'QUEUED',
          goal: input.goal!.trim(),
          productId: pinned.context.productId,
          productVersionId: pinned.context.versionId,
          modelConfigurationId: model.id,
          contextSha256: pinned.sha256,
          contextSnapshot: pinned.context as Prisma.InputJsonValue,
          citations: pinned.context.citations as Prisma.InputJsonValue,
          plan: plan as Prisma.InputJsonValue,
          constraints: DEFAULT_RUN_LIMITS as Prisma.InputJsonValue,
          createdBy: actor.userId,
          inputRedacted: redactValue({ triggerType: input.triggerType, agent: agent.name, goal: input.goal }) as Prisma.InputJsonValue,
        },
      });
      const outbox = await tx.outboxEvent.create({
        data: { tenantId, eventType: AGENT_RUN_EVENT, aggregateId: run.id, payload: { runId: run.id } },
      });
      await this.audit(tx, tenantId, actor.userId, 'agent.run.create', 'agent_run', run.id, requestId, { triggerType: input.triggerType, versionId: pinned.context.versionId });
      return { run, outboxId: outbox.id, modelId: model.id };
    });
    if (this.config.env.SALESOS_PROCESS_AGENTS === 'inline') await this.execute(tenantId, created.run.id, created.modelId, created.outboxId);
    return this.runRecord(actor, created.run.id);
  }

  cancelRun(actor: SessionContext, id: string, requestId: string) {
    return this.transitionRun(actor, id, ['QUEUED', 'RUNNING', 'PAUSED', 'WAITING_APPROVAL', 'FAILED_RETRYABLE'], 'CANCELLED', requestId, 'agent.run.cancel');
  }

  pauseRun(actor: SessionContext, id: string, requestId: string) {
    this.require(actor, 'automation.pause');
    return this.transitionRun(actor, id, ['QUEUED', 'RUNNING', 'WAITING_APPROVAL'], 'PAUSED', requestId, 'agent.run.pause');
  }

  async resumeRun(actor: SessionContext, id: string, requestId: string) {
    this.require(actor, 'automation.pause');
    const tenantId = this.tenant(actor);
    const outboxId = await withTenant(this.database.prisma, tenantId, async (tx) => {
      const run = await tx.agentRun.findUnique({ where: { tenantId_id: { tenantId, id } } });
      if (!run || run.state !== 'PAUSED') throw new ApiException(409, 'CONFLICT', 'Only a paused run can be resumed');
      const gate = await tx.$queryRaw<Array<{ tenant_status: string; automation_status: string }>>`SELECT tenant_status, automation_status FROM public.read_execution_gate(${tenantId}::uuid)`;
      if (gate[0]?.tenant_status !== 'ACTIVE') throw new ApiException(409, 'SUSPENDED', 'The organization is suspended');
      if (!(await tx.membership.findUnique({ where: { tenantId_userId: { tenantId, userId: run.createdBy } }, include: { roles: { include: { role: { include: { permissions: true } } } } } }))?.roles.some((link) => link.role.permissions.some((item) => item.permission === 'agents.manage'))) {
        throw new ApiException(409, 'AUTHZ_REVOKED', 'The run initiator is no longer authorized');
      }
      if (run.agentId) {
        const agent = await tx.agentProfile.findUnique({ where: { tenantId_id: { tenantId, id: run.agentId } } });
        if (!agent || !agent.enabled || agent.status !== 'ACTIVE') throw new ApiException(409, 'CONFLICT', 'The agent is not active');
      }
      if (run.modelConfigurationId) {
        const model = await tx.modelConfiguration.findUnique({ where: { tenantId_id: { tenantId, id: run.modelConfigurationId } } });
        if (!model?.enabled) throw new ApiException(422, 'MODEL_REQUIRED', 'The selected model is disabled');
      }
      if (run.productVersionId) {
        const version = await tx.productVersion.findUnique({ where: { tenantId_id: { tenantId, id: run.productVersionId } } });
        if (!version || (version.status !== 'PUBLISHED' && version.status !== 'SUPERSEDED')) throw new ApiException(409, 'VERSION_NOT_PUBLISHED', 'The pinned product version is no longer authorized');
      }
      const pending = await tx.agentAction.findMany({ where: { tenantId, runId: id, state: 'NEEDS_APPROVAL' } });
      for (const action of pending) {
        const decision = decide(
          { actionType: 'DRAFT_MESSAGE', external: true, firstOutbound: true, commercialCommitment: textHasCommercialCommitment(JSON.stringify(action.payload ?? {})) },
          { autonomyLevel: 'A1', suppressed: false, humanOwned: false, audienceKnown: false, killSwitch: gate[0]?.automation_status === 'PAUSED' },
        );
        if (decision.decision === 'BLOCK') {
          await tx.agentAction.update({ where: { tenantId_id: { tenantId, id: action.id } }, data: { state: 'BLOCKED', outcome: { sent: false } } });
          await tx.agentApproval.updateMany({ where: { tenantId, actionId: action.id, decision: 'PENDING' }, data: { decision: 'REJECTED', decidedAt: new Date(), comment: decision.reason } });
        }
      }
      await tx.agentRun.update({ where: { tenantId_id: { tenantId, id } }, data: { state: 'QUEUED', finishedAt: null, leaseToken: null, leaseUntil: null, leaseVersion: { increment: 1 } } });
      const outbox = await tx.outboxEvent.create({
        data: { tenantId, eventType: AGENT_RUN_EVENT, aggregateId: id, payload: { runId: id } },
      });
      await this.audit(tx, tenantId, actor.userId, 'agent.run.resume', 'agent_run', id, requestId);
      return outbox.id;
    });
    if (this.config.env.SALESOS_PROCESS_AGENTS === 'inline') {
      const run = await withTenant(this.database.prisma, tenantId, (tx) => tx.agentRun.findUnique({ where: { tenantId_id: { tenantId, id } } }));
      if (run?.modelConfigurationId) await this.execute(tenantId, id, run.modelConfigurationId, outboxId);
    }
    return this.runRecord(actor, id);
  }

  archiveRun(actor: SessionContext, id: string, requestId: string) {
    this.require(actor, 'agents.manage');
    return this.markArchived(actor, id, requestId);
  }

  async replayRun(actor: SessionContext, id: string, requestId: string) {
    this.require(actor, 'agents.manage');
    const tenantId = this.tenant(actor);
    const parent = await withTenant(this.database.prisma, tenantId, (tx) => tx.agentRun.findUnique({ where: { tenantId_id: { tenantId, id } } }));
    if (!parent) throw new ApiException(404, 'NOT_FOUND', 'Run was not found');
    return this.createRun(actor, { triggerType: parent.triggerType === 'TEST' ? 'TEST' : 'SCAN', agentId: parent.agentId ?? undefined, productId: parent.productId ?? undefined, productVersionId: parent.productVersionId ?? undefined, modelConfigurationId: parent.modelConfigurationId ?? undefined, goal: parent.goal }, requestId).then(async (created) => {
      await withTenant(this.database.prisma, tenantId, (tx) => tx.agentRun.update({
        where: { tenantId_id: { tenantId, id: created.id } },
        data: { parentRunId: parent.id },
      }));
      return this.runRecord(actor, created.id);
    });
  }

  bulkCancelRuns(actor: SessionContext, ids: string[], requestId: string) {
    return runBatch(ids, (id) => this.cancelRun(actor, id, requestId));
  }

  bulkArchiveRuns(actor: SessionContext, ids: string[], requestId: string) {
    return runBatch(ids, (id) => this.archiveRun(actor, id, requestId));
  }

  async policyRecord(actor: SessionContext, id: string) {
    this.require(actor, 'agents.read');
    const tenantId = this.tenant(actor);
    const row = await withTenant(this.database.prisma, tenantId, (tx) => tx.automationPolicy.findUnique({ where: { tenantId_id: { tenantId, id } } }));
    if (!row) throw new ApiException(404, 'NOT_FOUND', 'Policy was not found');
    return publicPolicy(row);
  }

  policyDirectory(actor: SessionContext, query: AgentPageDto) {
    return this.directory(actor, 'policy', query, POLICY_SORT);
  }

  async createPolicy(actor: SessionContext, input: PolicyCreateDto, requestId: string) {
    this.require(actor, 'agents.manage');
    const tenantId = this.tenant(actor);
    const row = await withTenant(this.database.prisma, tenantId, async (tx) => {
      const created = await tx.automationPolicy.create({
        data: { tenantId, name: input.name.trim(), autonomyLevel: input.autonomyLevel, channel: input.channel, actionType: input.actionType },
      });
      await this.audit(tx, tenantId, actor.userId, 'policy.create', 'automation_policy', created.id, requestId, { version: created.version });
      return created;
    });
    return publicPolicy(row);
  }

  async updatePolicy(actor: SessionContext, input: PolicyChangeDto, requestId: string) {
    this.require(actor, 'agents.manage');
    const tenantId = this.tenant(actor);
    const row = await withTenant(this.database.prisma, tenantId, async (tx) => {
      const current = await tx.automationPolicy.findUnique({ where: { tenantId_id: { tenantId, id: input.id } } });
      if (!current || current.status === 'ARCHIVED') throw new ApiException(404, 'NOT_FOUND', 'Policy was not found');
      const updated = await tx.automationPolicy.update({
        where: { tenantId_id: { tenantId, id: input.id } },
        data: {
          name: input.name.trim(),
          autonomyLevel: input.autonomyLevel,
          channel: input.channel,
          actionType: input.actionType,
          version: current.version + 1,
          effectiveAt: new Date(),
        },
      });
      await this.audit(tx, tenantId, actor.userId, 'policy.update', 'automation_policy', updated.id, requestId, { version: updated.version });
      return updated;
    });
    return publicPolicy(row);
  }

  async archivePolicy(actor: SessionContext, id: string, requestId: string) {
    this.require(actor, 'agents.manage');
    const tenantId = this.tenant(actor);
    const row = await withTenant(this.database.prisma, tenantId, async (tx) => {
      const current = await tx.automationPolicy.findUnique({ where: { tenantId_id: { tenantId, id } } });
      if (!current) throw new ApiException(404, 'NOT_FOUND', 'Policy was not found');
      const updated = await tx.automationPolicy.update({ where: { tenantId_id: { tenantId, id } }, data: { status: 'ARCHIVED', archivedAt: new Date() } });
      await this.audit(tx, tenantId, actor.userId, 'policy.archive', 'automation_policy', id, requestId);
      return updated;
    });
    return publicPolicy(row);
  }

  async automation(actor: SessionContext) {
    const tenantId = this.tenant(actor);
    const rows = await withTenant(this.database.prisma, tenantId, (tx) =>
      tx.$queryRaw<Array<{ automation_status: string }>>`SELECT automation_status FROM public.read_automation_settings(${tenantId}::uuid)`,
    );
    return { status: rows[0]?.automation_status ?? 'RUNNING' };
  }

  async setAutomation(actor: SessionContext, status: 'RUNNING' | 'PAUSED', requestId: string) {
    this.require(actor, 'automation.pause');
    const tenantId = this.tenant(actor);
    await withTenant(this.database.prisma, tenantId, async (tx) => {
      await tx.$executeRaw`SELECT public.set_automation_status(${status}, ${actor.userId}::uuid)`;
      await this.audit(tx, tenantId, actor.userId, status === 'PAUSED' ? 'automation.pause' : 'automation.resume', 'organization', tenantId, requestId);
    });
    return this.automation(actor);
  }

  private async directory(actor: SessionContext, kind: 'agent' | 'run' | 'policy', query: AgentPageDto, allow: Set<string>) {
    this.require(actor, 'agents.read');
    if (query.sortBy && !allow.has(query.sortBy)) throw new ApiException(400, 'VALIDATION_ERROR', 'That sort is not available');
    const tenantId = this.tenant(actor);
    const page = query.page ?? 1;
    const pageSize = Math.min(Math.max(query.pageSize ?? 20, 1), 100);
    const direction: Prisma.SortOrder = query.sortDirection === 'desc' ? 'desc' : 'asc';
    const needle = query.q?.trim();
    return withTenant(this.database.prisma, tenantId, async (tx) => {
      if (kind === 'agent') {
        const where = { tenantId, ...(query.status ? { status: query.status } : { status: { not: 'ARCHIVED' } }), ...(needle ? { name: { contains: needle, mode: 'insensitive' as const } } : {}) };
        const orderBy: Prisma.AgentProfileOrderByWithRelationInput[] = query.sortBy === 'status' ? [{ status: direction }, { id: 'asc' }] : query.sortBy === 'createdAt' ? [{ createdAt: direction }, { id: 'asc' }] : [{ name: direction }, { id: 'asc' }];
        const total = await tx.agentProfile.count({ where });
        const rows = await tx.agentProfile.findMany({ where, orderBy, skip: (page - 1) * pageSize, take: pageSize });
        return { items: rows.map(publicAgent), page, pageSize, total };
      }
      if (kind === 'policy') {
        const where = { tenantId, ...(query.status ? { status: query.status } : { status: 'ACTIVE' }), ...(needle ? { name: { contains: needle, mode: 'insensitive' as const } } : {}) };
        const orderBy: Prisma.AutomationPolicyOrderByWithRelationInput[] = query.sortBy === 'version' ? [{ version: direction }, { id: 'asc' }] : [{ name: direction }, { id: 'asc' }];
        const total = await tx.automationPolicy.count({ where });
        const rows = await tx.automationPolicy.findMany({ where, orderBy, skip: (page - 1) * pageSize, take: pageSize });
        return { items: rows.map(publicPolicy), page, pageSize, total };
      }
      const where = { tenantId, ...(query.status ? { state: query.status } : { archivedAt: null }), ...(needle ? { OR: [{ triggerType: { contains: needle, mode: 'insensitive' as const } }, { state: { contains: needle, mode: 'insensitive' as const } }] } : {}) };
      const orderBy: Prisma.AgentRunOrderByWithRelationInput[] = query.sortBy === 'state' ? [{ state: direction }, { id: 'asc' }] : query.sortBy === 'triggerType' ? [{ triggerType: direction }, { id: 'asc' }] : [{ createdAt: direction }, { id: 'asc' }];
      const total = await tx.agentRun.count({ where });
      const rows = await tx.agentRun.findMany({ where, orderBy, skip: (page - 1) * pageSize, take: pageSize });
      return { items: rows.map(publicRun), page, pageSize, total };
    });
  }

  private async setAgentStatus(actor: SessionContext, id: string, status: string, enabled: boolean, requestId: string) {
    this.require(actor, status === 'PAUSED' || status === 'ACTIVE' ? 'automation.pause' : 'agents.manage');
    if (status === 'ACTIVE' || status === 'PAUSED') this.require(actor, 'automation.pause');
    const tenantId = this.tenant(actor);
    const row = await withTenant(this.database.prisma, tenantId, async (tx) => {
      const current = await tx.agentProfile.findUnique({ where: { tenantId_id: { tenantId, id } } });
      if (!current) throw new ApiException(404, 'NOT_FOUND', 'Agent was not found');
      const updated = await tx.agentProfile.update({
        where: { tenantId_id: { tenantId, id } },
        data: { status, enabled, archivedAt: status === 'ARCHIVED' ? new Date() : null },
      });
      await this.audit(tx, tenantId, actor.userId, `agent.${status.toLowerCase()}`, 'agent', id, requestId);
      return updated;
    });
    return publicAgent(row);
  }

  private async transitionRun(actor: SessionContext, id: string, from: string[], state: string, requestId: string, action: string) {
    if (state === 'CANCELLED') this.require(actor, 'automation.pause');
    const tenantId = this.tenant(actor);
    await withTenant(this.database.prisma, tenantId, async (tx) => {
      const run = await tx.agentRun.findUnique({ where: { tenantId_id: { tenantId, id } } });
      if (!run) throw new ApiException(404, 'NOT_FOUND', 'Run was not found');
      if (!from.includes(run.state)) throw new ApiException(409, 'CONFLICT', 'The run cannot change from its current state');
      await tx.agentRun.update({ where: { tenantId_id: { tenantId, id } }, data: { state, leaseToken: null, leaseUntil: null, leaseVersion: { increment: 1 }, finishedAt: state === 'CANCELLED' ? new Date() : run.finishedAt } });
      if (state === 'CANCELLED') {
        await tx.agentAction.updateMany({ where: { tenantId, runId: id, state: { in: ['PROPOSED', 'POLICY_CHECKED', 'READY', 'PAUSED', 'NEEDS_APPROVAL'] } }, data: { state: 'CANCELLED' } });
      }
      await this.audit(tx, tenantId, actor.userId, action, 'agent_run', id, requestId);
    });
    return this.runRecord(actor, id);
  }

  private async markArchived(actor: SessionContext, id: string, requestId: string) {
    const tenantId = this.tenant(actor);
    await withTenant(this.database.prisma, tenantId, async (tx) => {
      const run = await tx.agentRun.findUnique({ where: { tenantId_id: { tenantId, id } } });
      if (!run) throw new ApiException(404, 'NOT_FOUND', 'Run was not found');
      await tx.agentRun.update({ where: { tenantId_id: { tenantId, id } }, data: { archivedAt: new Date() } });
      await this.audit(tx, tenantId, actor.userId, 'agent.run.archive', 'agent_run', id, requestId);
    });
    return this.runRecord(actor, id);
  }

  private async ensureAgent(tx: Prisma.TransactionClient, tenantId: string, userId: string, agentId?: string) {
    if (agentId) {
      const agent = await tx.agentProfile.findUnique({ where: { tenantId_id: { tenantId, id: agentId } } });
      if (!agent || agent.status !== 'ACTIVE' || !agent.enabled) throw new ApiException(404, 'NOT_FOUND', 'Agent was not found');
      return agent;
    }
    const existing = await tx.agentProfile.findFirst({ where: { tenantId, status: 'ACTIVE', enabled: true }, orderBy: { createdAt: 'asc' } });
    if (existing) return existing;
    return tx.agentProfile.create({
      data: { tenantId, name: 'Sales supervisor', role: 'Coordinates internal work. External sends stay behind policy.', createdBy: userId },
    });
  }

  async modelDirectory(actor: SessionContext, query: AgentPageDto) {
    this.require(actor, 'agents.read');
    const tenantId = this.tenant(actor);
    const page = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? 20, 100);
    return withTenant(this.database.prisma, tenantId, async (tx) => {
      const where = { tenantId, ...(query.q ? { name: { contains: query.q, mode: 'insensitive' as const } } : {}) };
      const total = await tx.modelConfiguration.count({ where });
      const rows = await tx.modelConfiguration.findMany({ where, orderBy: [{ name: 'asc' }, { id: 'asc' }], skip: (page - 1) * pageSize, take: pageSize });
      return { items: rows.map(publicModel), page, pageSize, total };
    });
  }

  async modelRecord(actor: SessionContext, id: string) {
    this.require(actor, 'agents.read');
    const tenantId = this.tenant(actor);
    const row = await withTenant(this.database.prisma, tenantId, (tx) => tx.modelConfiguration.findUnique({ where: { tenantId_id: { tenantId, id } } }));
    if (!row) throw new ApiException(404, 'NOT_FOUND', 'Model configuration was not found');
    return publicModel(row);
  }

  async createModel(actor: SessionContext, input: ModelCreateDto, requestId: string) {
    this.require(actor, 'agents.manage');
    this.assertEndpoint(input);
    const tenantId = this.tenant(actor);
    const row = await withTenant(this.database.prisma, tenantId, async (tx) => {
      if (input.isDefault) await tx.modelConfiguration.updateMany({ where: { tenantId, isDefault: true }, data: { isDefault: false } });
      const created = await tx.modelConfiguration.create({ data: this.modelData(actor.userId, tenantId, input) });
      await this.audit(tx, tenantId, actor.userId, 'model.create', 'model_configuration', created.id, requestId, { provider: created.provider });
      return created;
    });
    return publicModel(row);
  }

  async updateModel(actor: SessionContext, input: ModelChangeDto, requestId: string) {
    this.require(actor, 'agents.manage');
    this.assertEndpoint(input);
    const tenantId = this.tenant(actor);
    const row = await withTenant(this.database.prisma, tenantId, async (tx) => {
      const current = await tx.modelConfiguration.findUnique({ where: { tenantId_id: { tenantId, id: input.id } } });
      if (!current) throw new ApiException(404, 'NOT_FOUND', 'Model configuration was not found');
      if (input.isDefault) await tx.modelConfiguration.updateMany({ where: { tenantId, isDefault: true }, data: { isDefault: false } });
      const updated = await tx.modelConfiguration.update({ where: { tenantId_id: { tenantId, id: input.id } }, data: { ...this.modelData(actor.userId, tenantId, input), enabled: input.enabled ?? current.enabled, createdBy: current.createdBy } });
      await this.audit(tx, tenantId, actor.userId, 'model.update', 'model_configuration', updated.id, requestId, { provider: updated.provider });
      return updated;
    });
    return publicModel(row);
  }

  async testModel(actor: SessionContext, id: string, requestId: string) {
    this.require(actor, 'agents.manage');
    const tenantId = this.tenant(actor);
    const selection = await readModelSelection(this.database.prisma, tenantId, id, decodeEncryptionKey(this.config.env.DATA_ENCRYPTION_KEY), this.config.env.NODE_ENV !== 'production').catch((error: Error) => {
      throw new ApiException(422, 'MODEL_UNAVAILABLE', error.message);
    });
    const client = await createModelClient(selection);
    try {
      const result = await client.generateStructured<{ summary?: string }>({
        tenantId,
        task: 'supervisor.ping',
        promptVersion: 'mvp-1',
        messages: [{ role: 'user', content: 'PRODUCT: connection test\nCITATIONS: none\nGOAL: ping' }],
        outputSchema: { type: 'object', required: ['summary'] },
        timeoutMs: selection.timeoutMs,
        maxTokens: 50,
      });
      await withTenant(this.database.prisma, tenantId, (tx) => this.audit(tx, tenantId, actor.userId, 'model.test', 'model_configuration', id, requestId, { provider: selection.provider, ok: true }));
      return { ok: true, provider: selection.provider, model: result.model, traceId: result.traceId, summary: result.result.summary ?? '' };
    } catch (error) {
      const status = typeof error === 'object' && error && 'status' in error ? Number((error as { status: number }).status) : 503;
      throw new ApiException(status === 400 ? 400 : 422, 'MODEL_UNAVAILABLE', 'The model provider test failed');
    }
  }

  async approvalDirectory(actor: SessionContext, query: AgentPageDto) {
    if (!actor.permissions.includes('approvals.manage') && !actor.permissions.includes('approvals.review')) throw new ApiException(403, 'FORBIDDEN', 'You do not have permission for this action');
    const tenantId = this.tenant(actor);
    const page = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? 20, 100);
    return withTenant(this.database.prisma, tenantId, async (tx) => {
      await tx.agentApproval.updateMany({ where: { tenantId, decision: 'PENDING', expiresAt: { lt: new Date() } }, data: { decision: 'EXPIRED', decidedAt: new Date() } });
      const where = { tenantId, ...(query.status ? { decision: query.status } : {}) };
      const total = await tx.agentApproval.count({ where });
      const rows = await tx.agentApproval.findMany({ where, orderBy: [{ requestedAt: 'desc' }, { id: 'asc' }], skip: (page - 1) * pageSize, take: pageSize });
      return { items: rows.map(publicApproval), page, pageSize, total };
    });
  }

  async approvalRecord(actor: SessionContext, id: string) {
    if (!actor.permissions.includes('approvals.manage') && !actor.permissions.includes('approvals.review') && !actor.permissions.includes('agents.read')) {
      throw new ApiException(403, 'FORBIDDEN', 'You do not have permission for this action');
    }
    const tenantId = this.tenant(actor);
    const row = await withTenant(this.database.prisma, tenantId, (tx) => tx.agentApproval.findUnique({ where: { tenantId_id: { tenantId, id } } }));
    if (!row) throw new ApiException(404, 'NOT_FOUND', 'Approval was not found');
    return publicApproval(row);
  }

  async decideApproval(actor: SessionContext, input: ApprovalDecisionDto, requestId: string) {
    if (!actor.permissions.includes('approvals.manage') && !actor.permissions.includes('approvals.review')) throw new ApiException(403, 'FORBIDDEN', 'You do not have permission for this action');
    const tenantId = this.tenant(actor);
    return withTenant(this.database.prisma, tenantId, async (tx) => {
      const current = await tx.agentApproval.findUnique({ where: { tenantId_id: { tenantId, id: input.id } } });
      if (!current) throw new ApiException(404, 'NOT_FOUND', 'Approval was not found');
      if (current.decision !== 'PENDING') throw new ApiException(409, 'CONFLICT', 'This approval already has a decision');
      if (current.expiresAt.getTime() < Date.now()) {
        await tx.agentApproval.update({ where: { tenantId_id: { tenantId, id: input.id } }, data: { decision: 'EXPIRED', decidedAt: new Date() } });
        throw new ApiException(409, 'EXPIRED', 'This approval has expired');
      }
      if (current.payloadSha256 !== input.payloadSha256) throw new ApiException(409, 'PAYLOAD_CHANGED', 'The proposed action changed');
      const gate = await tx.$queryRaw<Array<{ tenant_status: string; automation_status: string }>>`SELECT tenant_status, automation_status FROM public.read_execution_gate(${tenantId}::uuid)`;
      if (gate[0]?.tenant_status !== 'ACTIVE') throw new ApiException(409, 'SUSPENDED', 'The organization is suspended');
      if (input.decision === 'APPROVED' && gate[0]?.automation_status === 'PAUSED') throw new ApiException(409, 'PAUSED', 'Paused automation cannot approve an external action');
      const changed = await tx.agentApproval.updateMany({ where: { tenantId, id: input.id, decision: 'PENDING', payloadSha256: input.payloadSha256 }, data: { decision: input.decision, decidedBy: actor.userId, decidedAt: new Date(), comment: input.comment ?? null } });
      if (changed.count !== 1) throw new ApiException(409, 'CONFLICT', 'This approval already has a decision');
      const actionState = input.decision === 'APPROVED' ? 'APPROVED_NOT_EXECUTABLE' : input.decision === 'REJECTED' ? 'BLOCKED' : 'NEEDS_APPROVAL';
      await tx.agentAction.update({ where: { tenantId_id: { tenantId, id: current.actionId } }, data: { state: actionState, approvedBy: input.decision === 'APPROVED' ? actor.userId : null, outcome: { sent: false, executable: false } } });
      if (input.decision !== 'CHANGES_REQUESTED') {
        await tx.agentRun.updateMany({ where: { tenantId, id: current.runId, state: 'WAITING_APPROVAL' }, data: { state: 'SUCCEEDED' } });
      }
      await this.audit(tx, tenantId, actor.userId, `approval.${input.decision.toLowerCase()}`, 'agent_approval', input.id, requestId, { sent: false });
      const saved = await tx.agentApproval.findUnique({ where: { tenantId_id: { tenantId, id: input.id } } });
      return publicApproval(saved!);
    });
  }

  private modelData(userId: string, tenantId: string, input: ModelCreateDto): Prisma.ModelConfigurationUncheckedCreateInput {
    const key = decodeEncryptionKey(this.config.env.DATA_ENCRYPTION_KEY);
    const ciphertext = input.apiKey ? new Uint8Array(encryptField(input.apiKey, key)) : undefined;
    return {
      tenantId,
      name: input.name.trim(),
      provider: input.provider,
      model: input.model.trim(),
      baseUrl: input.baseUrl ?? null,
      authMethod: input.apiKey ? 'bearer' : 'none',
      credentialCiphertext: ciphertext,
      credentialHint: input.apiKey ? input.apiKey.slice(-4) : null,
      inputPriceMinorPerMillion: input.inputPriceMinorPerMillion ?? 0,
      outputPriceMinorPerMillion: input.outputPriceMinorPerMillion ?? 0,
      allowPrivateHttp: Boolean(input.allowPrivateHttp && this.config.env.NODE_ENV !== 'production'),
      isDefault: Boolean(input.isDefault),
      createdBy: userId,
    };
  }

  private assertEndpoint(input: ModelCreateDto): void {
    if (input.provider === 'fake') return;
    if (!input.baseUrl) throw new ApiException(400, 'VALIDATION_ERROR', 'A model endpoint is required');
    let url: URL;
    try { url = new URL(input.baseUrl); } catch { throw new ApiException(400, 'VALIDATION_ERROR', 'The model endpoint is not a valid URL'); }
    const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    if (url.protocol !== 'https:' && !(input.allowPrivateHttp && loopback && this.config.env.NODE_ENV !== 'production')) {
      throw new ApiException(400, 'VALIDATION_ERROR', 'Remote model endpoints must use HTTPS');
    }
  }

  private async execute(tenantId: string, runId: string, modelId: string, outboxId: string): Promise<void> {
    try {
    const key = decodeEncryptionKey(this.config.env.DATA_ENCRYPTION_KEY);
    const selection = await readModelSelection(this.database.prisma, tenantId, modelId, key, this.config.env.NODE_ENV !== 'production');
    const client = await createModelClient(selection);
    await advanceAgentRun(this.database.prisma, tenantId, runId, {
      outboxId,
      complete: async (input) => {
        const generated = await client.generateStructured<Record<string, unknown>>({
          tenantId,
          task: input.task,
          promptVersion: 'mvp-1',
          messages: input.messages,
          outputSchema: {
            type: 'object',
            required: ['summary', 'strategy', 'draft'],
            properties: {
              summary: { type: 'string' },
              strategy: { type: 'string' },
              draft: { type: 'string' },
              citations: { type: 'array', items: { type: 'string' } },
            },
          },
          timeoutMs: input.timeoutMs,
          maxTokens: input.maxTokens,
        });
        return {
          result: generated.result,
          provider: selection.provider,
          model: generated.model,
          inputTokens: generated.usage.inputTokens,
          outputTokens: generated.usage.outputTokens,
          traceId: generated.traceId,
          durationMs: generated.latencyMs,
          usageExact: Boolean(generated.usageExact),
          inputPerMillion: selection.inputPerMillion,
          outputPerMillion: selection.outputPerMillion,
        };
      },
    });
    } catch {
      await withTenant(this.database.prisma, tenantId, (tx) => tx.agentRun.updateMany({
        where: { tenantId, id: runId, state: { in: ['QUEUED', 'RUNNING'] } },
        data: { state: 'FAILED_FINAL', errorCode: 'PROVIDER', leaseToken: null, finishedAt: new Date() },
      }));
    }
  }

  private tenant(actor: SessionContext): string {
    if (!actor.tenantId) throw new ApiException(409, 'ORGANIZATION_REQUIRED', 'Choose an organization first');
    return actor.tenantId;
  }

  private require(actor: SessionContext, permission: string): void {
    if (!actor.permissions.includes(permission)) throw new ApiException(403, 'FORBIDDEN', 'You do not have permission for this action');
  }

  private audit(tx: Prisma.TransactionClient, tenantId: string, actorId: string, action: string, entityType: string, entityId: string, requestId: string, payload: Prisma.InputJsonObject = {}) {
    return tx.auditEvent.create({ data: { tenantId, actorType: 'user', actorId, action, entityType, entityId, payload: { ...payload, requestId } } });
  }
}

function publicAgent(row: { id: string; name: string; role: string; instructions: string; status: string; enabled: boolean; modelConfigurationId?: string | null; defaultProductId?: string | null; createdAt: Date; updatedAt: Date; archivedAt: Date | null }) {
  return { id: row.id, name: row.name, role: row.role, instructions: row.instructions, status: row.status, enabled: row.enabled, modelConfigurationId: row.modelConfigurationId ?? null, defaultProductId: row.defaultProductId ?? null, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), archivedAt: row.archivedAt?.toISOString() ?? null };
}

function publicRun(row: { id: string; agentId: string | null; triggerType: string; state: string; errorCode: string | null; parentRunId: string | null; productId: string | null; productVersionId: string | null; goal: string; contextSha256: string | null; citations: Prisma.JsonValue; plan: Prisma.JsonValue; report: Prisma.JsonValue; modelProvider: string | null; modelName: string | null; createdAt: Date; startedAt: Date | null; finishedAt: Date | null; archivedAt: Date | null }) {
  return {
    id: row.id,
    agentId: row.agentId,
    triggerType: row.triggerType,
    state: row.state,
    errorCode: row.errorCode,
    parentRunId: row.parentRunId,
    productId: row.productId,
    productVersionId: row.productVersionId,
    goal: row.goal,
    contextSha256: row.contextSha256,
    citations: row.citations,
    plan: row.plan,
    report: row.report,
    modelProvider: row.modelProvider,
    modelName: row.modelName,
    createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    archivedAt: row.archivedAt?.toISOString() ?? null,
  };
}

function publicTool(row: { id: string; toolName: string; toolVersion: string; status: string; outputRedacted: Prisma.JsonValue; createdAt: Date }) {
  return { id: row.id, toolName: row.toolName, toolVersion: row.toolVersion, status: row.status, output: row.outputRedacted, createdAt: row.createdAt.toISOString() };
}

function publicModel(row: { id: string; name: string; provider: string; model: string; baseUrl: string | null; authMethod: string; credentialCiphertext: Uint8Array | null; credentialHint: string | null; timeoutMs: number; maxInputTokens: number; maxOutputTokens: number; inputPriceMinorPerMillion: number; outputPriceMinorPerMillion: number; currency: string; enabled: boolean; isDefault: boolean; allowPrivateHttp: boolean; createdAt: Date; updatedAt: Date }) {
  return { id: row.id, name: row.name, provider: row.provider, model: row.model, baseUrl: row.baseUrl, authMethod: row.authMethod, configured: Boolean(row.credentialCiphertext), credentialHint: row.credentialHint, timeoutMs: row.timeoutMs, maxInputTokens: row.maxInputTokens, maxOutputTokens: row.maxOutputTokens, inputPriceMinorPerMillion: row.inputPriceMinorPerMillion, outputPriceMinorPerMillion: row.outputPriceMinorPerMillion, currency: row.currency, enabled: row.enabled, isDefault: row.isDefault, allowPrivateHttp: row.allowPrivateHttp, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}

function publicApproval(row: { id: string; runId: string; actionId: string; payloadSha256: string; actionType: string; riskLevel: string; decision: string; comment: string | null; policyVersion: string | null; requestedAt: Date; expiresAt: Date; decidedAt: Date | null }) {
  return { id: row.id, runId: row.runId, actionId: row.actionId, payloadSha256: row.payloadSha256, actionType: row.actionType, riskLevel: row.riskLevel, decision: row.decision, comment: row.comment, policyVersion: row.policyVersion, requestedAt: row.requestedAt.toISOString(), expiresAt: row.expiresAt.toISOString(), decidedAt: row.decidedAt?.toISOString() ?? null };
}

function publicUsage(row: { id: string; provider: string; model: string; inputTokens: number; outputTokens: number; costMinor: number; usageSource: string; traceId: string | null; requestStatus: string | null }) {
  return { id: row.id, provider: row.provider, model: row.model, inputTokens: row.inputTokens, outputTokens: row.outputTokens, costMinor: row.costMinor, usageSource: row.usageSource, traceId: row.traceId, requestStatus: row.requestStatus };
}

function publicStep(row: { id: string; position: number; name: string; status: string; detailRedacted: Prisma.JsonValue; createdAt: Date }) {
  return { id: row.id, position: row.position, name: row.name, status: row.status, detail: row.detailRedacted, createdAt: row.createdAt.toISOString() };
}

function publicAction(row: { id: string; actionType: string; state: string; policyVersion: string | null; policyDecision: string | null; outcome: Prisma.JsonValue; createdAt: Date }) {
  return { id: row.id, actionType: row.actionType, state: row.state, policyVersion: row.policyVersion, policyDecision: row.policyDecision, outcome: row.outcome, createdAt: row.createdAt.toISOString() };
}

function publicPolicy(row: { id: string; name: string; status: string; autonomyLevel: string; channel: string | null; actionType: string | null; version: number; effectiveAt: Date }) {
  return { id: row.id, name: row.name, status: row.status, autonomyLevel: row.autonomyLevel, channel: row.channel, actionType: row.actionType, version: row.version, effectiveAt: row.effectiveAt.toISOString() };
}
