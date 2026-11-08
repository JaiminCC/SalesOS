import { Inject, Injectable } from '@nestjs/common';
import {
  advanceCampaignRun,
  assignAudience,
  assignSequence,
  campaignAnalytics,
  campaignRecord,
  cloneCampaign,
  createCampaign,
  createSegment,
  createSequence,
  createTemplate,
  decideApproval,
  freezeSequence,
  listCampaigns,
  listSegments,
  listSequences,
  listTemplates,
  materializeSegment,
  personalizeDraft,
  previewSegment,
  replaceSteps,
  requestApproval,
  segmentRecord,
  sequenceRecord,
  startSimulation,
  templateRecord,
  transitionCampaign,
  updateCampaign,
  updateSegment as saveSegment,
  CampaignError,
  withTenant,
} from '@salesos/database';
import type { StepType } from '@salesos/shared';
import { ApiException } from '../common/api.exception';
import { DatabaseService } from '../database/database.service';
import type { SessionContext } from '../identity/identity.service';
import type { AnalyticsDto, ApprovalDecisionDto, ApprovalRequestDto, AssignSegmentDto, AssignSequenceDto, CampaignBodyDto, CampaignChangeDto, CampaignIdsDto, CampaignPageDto, CampaignTransitionDto, PersonalizeDto, SegmentBodyDto, SegmentChangeDto, SegmentPreviewDto, SequenceBodyDto, SequenceStepsDto, TemplateBodyDto } from './campaign.dto';

@Injectable()
export class CampaignService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  list(actor: SessionContext, query: CampaignPageDto) {
    return this.run(listCampaigns(this.database.prisma, this.tenant(actor), query));
  }

  get(actor: SessionContext, id: string) {
    return this.run(campaignRecord(this.database.prisma, this.tenant(actor), id));
  }

  create(actor: SessionContext, body: CampaignBodyDto) {
    return this.run(createCampaign(this.database.prisma, this.actor(actor), body));
  }

  update(actor: SessionContext, body: CampaignChangeDto) {
    return this.run(updateCampaign(this.database.prisma, this.actor(actor), body));
  }

  clone(actor: SessionContext, id: string) {
    return this.run(cloneCampaign(this.database.prisma, this.actor(actor), id));
  }

  transition(actor: SessionContext, body: CampaignTransitionDto) {
    return this.run(transitionCampaign(this.database.prisma, this.actor(actor), body.id, body.revision, body.state));
  }

  async archive(actor: SessionContext, body: CampaignIdsDto) {
    const results = [];
    for (const id of body.ids) {
      const current = await this.get(actor, id);
      results.push(await this.transition(actor, { id, revision: current.revision, state: 'ARCHIVED' }));
    }
    return { items: results, sendAttempts: 0 };
  }

  segments(actor: SessionContext, query: CampaignPageDto) {
    return this.run(listSegments(this.database.prisma, this.tenant(actor), query));
  }

  segment(actor: SessionContext, id: string) {
    return this.run(segmentRecord(this.database.prisma, this.tenant(actor), id));
  }

  createSegment(actor: SessionContext, body: SegmentBodyDto) {
    return this.run(createSegment(this.database.prisma, this.actor(actor), body));
  }

  updateSegment(actor: SessionContext, body: SegmentChangeDto) {
    return this.run(saveSegment(this.database.prisma, this.actor(actor), body));
  }

  preview(actor: SessionContext, body: SegmentPreviewDto) {
    return this.run(previewSegment(this.database.prisma, this.actor(actor), body.filter, actor.permissions.includes('crm.leads.read')));
  }

  materialize(actor: SessionContext, id: string) {
    return this.run(materializeSegment(this.database.prisma, this.actor(actor), id));
  }

  assignSegment(actor: SessionContext, body: AssignSegmentDto) {
    return this.run(assignAudience(this.database.prisma, this.actor(actor), body.id, body.revision, body.segmentId));
  }

  sequences(actor: SessionContext, query: CampaignPageDto) {
    return this.run(listSequences(this.database.prisma, this.tenant(actor), query));
  }

  sequence(actor: SessionContext, id: string) {
    return this.run(sequenceRecord(this.database.prisma, this.tenant(actor), id));
  }

  createSequence(actor: SessionContext, body: SequenceBodyDto) {
    return this.run(createSequence(this.database.prisma, this.actor(actor), { ...body, steps: body.steps.map((step) => ({ position: step.position, stepType: step.stepType as StepType, config: step.config })) }));
  }

  saveSteps(actor: SessionContext, body: SequenceStepsDto) {
    return this.run(replaceSteps(this.database.prisma, this.actor(actor), body.id, body.steps.map((step) => ({ position: step.position, stepType: step.stepType as StepType, config: step.config }))));
  }

  freeze(actor: SessionContext, id: string) {
    return this.run(freezeSequence(this.database.prisma, this.actor(actor), id));
  }

  assignSequence(actor: SessionContext, body: AssignSequenceDto) {
    return this.run(assignSequence(this.database.prisma, this.actor(actor), body.id, body.revision, body.sequenceId));
  }

  templates(actor: SessionContext, query: CampaignPageDto) {
    return this.run(listTemplates(this.database.prisma, this.tenant(actor), query));
  }

  template(actor: SessionContext, id: string) {
    return this.run(templateRecord(this.database.prisma, this.tenant(actor), id));
  }

  createTemplate(actor: SessionContext, body: TemplateBodyDto) {
    return this.run(createTemplate(this.database.prisma, this.actor(actor), body));
  }

  requestApproval(actor: SessionContext, body: ApprovalRequestDto) {
    return this.run(requestApproval(this.database.prisma, this.actor(actor), body));
  }

  decide(actor: SessionContext, body: ApprovalDecisionDto) {
    return this.run(decideApproval(this.database.prisma, this.actor(actor), body));
  }

  personalize(actor: SessionContext, body: PersonalizeDto) {
    return this.run(personalizeDraft(this.database.prisma, this.actor(actor), { ...body, modelProvider: body.modelProvider ?? 'test', modelName: body.modelName ?? 'template' }));
  }

  simulate(actor: SessionContext, id: string) {
    return this.run(startSimulation(this.database.prisma, this.actor(actor), id));
  }

  advance(actor: SessionContext, id: string) {
    return this.run(advanceCampaignRun(this.database.prisma, this.actor(actor), id));
  }

  analytics(actor: SessionContext, body: AnalyticsDto) {
    return this.run(campaignAnalytics(this.database.prisma, this.tenant(actor), body.campaignId ?? null, { ownerUserId: body.ownerUserId, from: body.from, to: body.to }));
  }

  monitor(actor: SessionContext, id: string) {
    const tenantId = this.tenant(actor);
    return this.run(withTenant(this.database.prisma, tenantId, async (tx) => {
      const enrollments = await tx.campaignEnrollment.findMany({ where: { tenantId, campaignId: id }, orderBy: { createdAt: 'desc' }, take: 100 });
      const executions = await tx.campaignStepExecution.findMany({ where: { tenantId, enrollmentId: { in: enrollments.map((row) => row.id) } }, orderBy: { createdAt: 'desc' }, take: 100 });
      return { enrollments, executions, externalDelivery: 'NOT_AUTHORIZED', sent: 'NOT_AVAILABLE', sendAttempts: 0 };
    }));
  }

  private actor(actor: SessionContext) {
    return { tenantId: this.tenant(actor), userId: actor.userId };
  }

  private tenant(actor: SessionContext) {
    if (!actor.tenantId) throw new ApiException(409, 'ORGANIZATION_REQUIRED', 'Choose an organization first');
    return actor.tenantId;
  }

  private run<T>(work: Promise<T>): Promise<T> {
    return work.catch((error: unknown) => {
      if (error instanceof CampaignError) throw new ApiException(error.status, error.code, error.message);
      throw error;
    });
  }
}
