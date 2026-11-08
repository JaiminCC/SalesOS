import { Body, Controller, HttpCode, Inject, Post, Req, UseGuards } from '@nestjs/common';
import { apiSuccess } from '@salesos/shared';
import { PermissionGuard, SessionGuard, type AuthenticatedRequest } from '../identity/auth.guard';
import { RequirePermissions } from '../identity/require-permissions';
import { CampaignService } from './campaign.service';
import {
  AnalyticsDto,
  ApprovalDecisionDto,
  ApprovalRequestDto,
  AssignSegmentDto,
  AssignSequenceDto,
  CampaignBodyDto,
  CampaignChangeDto,
  CampaignIdDto,
  CampaignIdsDto,
  CampaignPageDto,
  CampaignTransitionDto,
  PersonalizeDto,
  SegmentBodyDto,
  SegmentChangeDto,
  SegmentPreviewDto,
  SequenceBodyDto,
  SequenceStepsDto,
  TemplateBodyDto,
} from './campaign.dto';

@Controller('management')
@UseGuards(SessionGuard, PermissionGuard)
export class CampaignController {
  constructor(@Inject(CampaignService) private readonly campaigns: CampaignService) {}

  @Post('campaigns/list') @HttpCode(200) @RequirePermissions('campaigns.read')
  list(@Body() body: CampaignPageDto, @Req() request: AuthenticatedRequest) { return this.ok(this.campaigns.list(request.auth!, body), request.requestId); }

  @Post('campaigns/get') @HttpCode(200) @RequirePermissions('campaigns.read')
  get(@Body() body: CampaignIdDto, @Req() request: AuthenticatedRequest) { return this.ok(this.campaigns.get(request.auth!, body.id), request.requestId); }

  @Post('campaigns/create') @HttpCode(200) @RequirePermissions('campaigns.create')
  create(@Body() body: CampaignBodyDto, @Req() request: AuthenticatedRequest) { return this.ok(this.campaigns.create(request.auth!, body), request.requestId); }

  @Post('campaigns/update') @HttpCode(200) @RequirePermissions('campaigns.edit')
  update(@Body() body: CampaignChangeDto, @Req() request: AuthenticatedRequest) { return this.ok(this.campaigns.update(request.auth!, body), request.requestId); }

  @Post('campaigns/clone') @HttpCode(200) @RequirePermissions('campaigns.create')
  clone(@Body() body: CampaignIdDto, @Req() request: AuthenticatedRequest) { return this.ok(this.campaigns.clone(request.auth!, body.id), request.requestId); }

  @Post('campaigns/archive') @HttpCode(200) @RequirePermissions('campaigns.archive')
  archive(@Body() body: CampaignIdsDto, @Req() request: AuthenticatedRequest) { return this.ok(this.campaigns.archive(request.auth!, body), request.requestId); }

  @Post('campaigns/transition') @HttpCode(200) @RequirePermissions('campaigns.edit')
  transition(@Body() body: CampaignTransitionDto, @Req() request: AuthenticatedRequest) { return this.ok(this.campaigns.transition(request.auth!, body), request.requestId); }

  @Post('segments/list') @HttpCode(200) @RequirePermissions('campaigns.read')
  segments(@Body() body: CampaignPageDto, @Req() request: AuthenticatedRequest) { return this.ok(this.campaigns.segments(request.auth!, body), request.requestId); }

  @Post('segments/get') @HttpCode(200) @RequirePermissions('campaigns.read')
  segment(@Body() body: CampaignIdDto, @Req() request: AuthenticatedRequest) { return this.ok(this.campaigns.segment(request.auth!, body.id), request.requestId); }

  @Post('segments/create') @HttpCode(200) @RequirePermissions('campaigns.audience.manage')
  createSegment(@Body() body: SegmentBodyDto, @Req() request: AuthenticatedRequest) { return this.ok(this.campaigns.createSegment(request.auth!, body), request.requestId); }

  @Post('segments/update') @HttpCode(200) @RequirePermissions('campaigns.audience.manage')
  updateSegment(@Body() body: SegmentChangeDto, @Req() request: AuthenticatedRequest) { return this.ok(this.campaigns.updateSegment(request.auth!, body), request.requestId); }

  @Post('segments/clone') @HttpCode(200) @RequirePermissions('campaigns.audience.manage')
  async cloneSegment(@Body() body: CampaignIdDto, @Req() request: AuthenticatedRequest) {
    const current = await this.campaigns.segment(request.auth!, body.id);
    const version = current.versions[0];
    return this.ok(this.campaigns.createSegment(request.auth!, { name: `${current.name} copy`, description: current.description, kind: current.kind === 'SNAPSHOT' ? 'SNAPSHOT' : 'DYNAMIC', filter: (version?.filter ?? { op: 'and', items: [] }) as Record<string, unknown> }), request.requestId);
  }

  @Post('segments/preview') @HttpCode(200) @RequirePermissions('campaigns.read')
  preview(@Body() body: SegmentPreviewDto, @Req() request: AuthenticatedRequest) { return this.ok(this.campaigns.preview(request.auth!, body), request.requestId); }

  @Post('segments/materialize') @HttpCode(200) @RequirePermissions('campaigns.audience.manage')
  materialize(@Body() body: CampaignIdDto, @Req() request: AuthenticatedRequest) { return this.ok(this.campaigns.materialize(request.auth!, body.id), request.requestId); }

  @Post('campaign-audiences/assign') @HttpCode(200) @RequirePermissions('campaigns.audience.manage')
  assignAudience(@Body() body: AssignSegmentDto, @Req() request: AuthenticatedRequest) { return this.ok(this.campaigns.assignSegment(request.auth!, body), request.requestId); }

  @Post('sequences/list') @HttpCode(200) @RequirePermissions('campaigns.read')
  sequences(@Body() body: CampaignPageDto, @Req() request: AuthenticatedRequest) { return this.ok(this.campaigns.sequences(request.auth!, body), request.requestId); }

  @Post('sequences/get') @HttpCode(200) @RequirePermissions('campaigns.read')
  sequence(@Body() body: CampaignIdDto, @Req() request: AuthenticatedRequest) { return this.ok(this.campaigns.sequence(request.auth!, body.id), request.requestId); }

  @Post('sequences/create') @HttpCode(200) @RequirePermissions('campaigns.sequence.manage')
  createSequence(@Body() body: SequenceBodyDto, @Req() request: AuthenticatedRequest) { return this.ok(this.campaigns.createSequence(request.auth!, body), request.requestId); }

  @Post('sequences/steps') @HttpCode(200) @RequirePermissions('campaigns.sequence.manage')
  steps(@Body() body: SequenceStepsDto, @Req() request: AuthenticatedRequest) { return this.ok(this.campaigns.saveSteps(request.auth!, body), request.requestId); }

  @Post('sequences/freeze') @HttpCode(200) @RequirePermissions('campaigns.sequence.manage')
  freeze(@Body() body: CampaignIdDto, @Req() request: AuthenticatedRequest) { return this.ok(this.campaigns.freeze(request.auth!, body.id), request.requestId); }

  @Post('sequences/assign') @HttpCode(200) @RequirePermissions('campaigns.sequence.manage')
  assignSequence(@Body() body: AssignSequenceDto, @Req() request: AuthenticatedRequest) { return this.ok(this.campaigns.assignSequence(request.auth!, body), request.requestId); }

  @Post('campaign-templates/list') @HttpCode(200) @RequirePermissions('campaigns.read')
  templates(@Body() body: CampaignPageDto, @Req() request: AuthenticatedRequest) { return this.ok(this.campaigns.templates(request.auth!, body), request.requestId); }

  @Post('campaign-templates/get') @HttpCode(200) @RequirePermissions('campaigns.read')
  template(@Body() body: CampaignIdDto, @Req() request: AuthenticatedRequest) { return this.ok(this.campaigns.template(request.auth!, body.id), request.requestId); }

  @Post('campaign-templates/create') @HttpCode(200) @RequirePermissions('campaigns.template.manage')
  createTemplate(@Body() body: TemplateBodyDto, @Req() request: AuthenticatedRequest) { return this.ok(this.campaigns.createTemplate(request.auth!, body), request.requestId); }

  @Post('campaign-approvals/request') @HttpCode(200) @RequirePermissions('campaigns.edit')
  requestApproval(@Body() body: ApprovalRequestDto, @Req() request: AuthenticatedRequest) { return this.ok(this.campaigns.requestApproval(request.auth!, body), request.requestId); }

  @Post('campaign-approvals/decide') @HttpCode(200) @RequirePermissions('campaigns.review')
  decide(@Body() body: ApprovalDecisionDto, @Req() request: AuthenticatedRequest) { return this.ok(this.campaigns.decide(request.auth!, body), request.requestId); }

  @Post('campaign-simulation/personalize') @HttpCode(200) @RequirePermissions('campaigns.simulate')
  personalize(@Body() body: PersonalizeDto, @Req() request: AuthenticatedRequest) { return this.ok(this.campaigns.personalize(request.auth!, body), request.requestId); }

  @Post('campaign-simulation/start') @HttpCode(200) @RequirePermissions('campaigns.simulate')
  start(@Body() body: CampaignIdDto, @Req() request: AuthenticatedRequest) { return this.ok(this.campaigns.simulate(request.auth!, body.id), request.requestId); }

  @Post('campaign-simulation/advance') @HttpCode(200) @RequirePermissions('campaigns.simulate')
  advance(@Body() body: CampaignIdDto, @Req() request: AuthenticatedRequest) { return this.ok(this.campaigns.advance(request.auth!, body.id), request.requestId); }

  @Post('campaign-simulation/monitor') @HttpCode(200) @RequirePermissions('campaigns.read')
  monitor(@Body() body: CampaignIdDto, @Req() request: AuthenticatedRequest) { return this.ok(this.campaigns.monitor(request.auth!, body.id), request.requestId); }

  @Post('campaign-analytics/summary') @HttpCode(200) @RequirePermissions('campaigns.analytics.read')
  analytics(@Body() body: AnalyticsDto, @Req() request: AuthenticatedRequest) { return this.ok(this.campaigns.analytics(request.auth!, body), request.requestId); }

  private ok<T>(value: Promise<T> | T, requestId: string) {
    return Promise.resolve(value).then((data) => apiSuccess(data, requestId));
  }
}
