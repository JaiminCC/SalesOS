import { Body, Controller, HttpCode, Inject, Post, Req, UseGuards } from '@nestjs/common';
import { apiSuccess } from '@salesos/shared';
import { PermissionGuard, SessionGuard, type AuthenticatedRequest } from '../identity/auth.guard';
import { RequirePermissions } from '../identity/require-permissions';
import { RecordIdDto, RecordIdsDto } from '../management/management.dto';
import { AgentChangeDto, AgentCreateDto, AgentPageDto, ApprovalDecisionDto, ModelChangeDto, ModelCreateDto, PolicyChangeDto, PolicyCreateDto, RunCreateDto } from './agents.dto';
import { AgentsService } from './agents.service';

@Controller('management')
@UseGuards(SessionGuard, PermissionGuard)
export class AgentsController {
  constructor(@Inject(AgentsService) private readonly agents: AgentsService) {}

  @Post('agents/list')
  @RequirePermissions('agents.read')
  @HttpCode(200)
  listAgents(@Body() body: AgentPageDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.agents.agentDirectory(request.auth!, body), request.requestId);
  }

  @Post('agents/get')
  @RequirePermissions('agents.read')
  @HttpCode(200)
  agent(@Body() body: RecordIdDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.agents.agentRecord(request.auth!, body.id), request.requestId);
  }

  @Post('agents/create')
  @RequirePermissions('agents.manage')
  @HttpCode(201)
  createAgent(@Body() body: AgentCreateDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.agents.createAgent(request.auth!, body, request.requestId), request.requestId);
  }

  @Post('agents/update')
  @RequirePermissions('agents.manage')
  @HttpCode(200)
  updateAgent(@Body() body: AgentChangeDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.agents.updateAgent(request.auth!, body, request.requestId), request.requestId);
  }

  @Post('agents/pause')
  @RequirePermissions('automation.pause')
  @HttpCode(200)
  pauseAgent(@Body() body: RecordIdDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.agents.pauseAgent(request.auth!, body.id, request.requestId), request.requestId);
  }

  @Post('agents/resume')
  @RequirePermissions('automation.pause')
  @HttpCode(200)
  resumeAgent(@Body() body: RecordIdDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.agents.resumeAgent(request.auth!, body.id, request.requestId), request.requestId);
  }

  @Post('agents/archive')
  @RequirePermissions('agents.manage')
  @HttpCode(200)
  archiveAgent(@Body() body: RecordIdDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.agents.archiveAgent(request.auth!, body.id, request.requestId), request.requestId);
  }

  @Post('agents/bulk-pause')
  @RequirePermissions('automation.pause')
  @HttpCode(200)
  bulkPause(@Body() body: RecordIdsDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.agents.bulkPauseAgents(request.auth!, body.ids, request.requestId), request.requestId);
  }

  @Post('agents/bulk-archive')
  @RequirePermissions('agents.manage')
  @HttpCode(200)
  bulkArchive(@Body() body: RecordIdsDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.agents.bulkArchiveAgents(request.auth!, body.ids, request.requestId), request.requestId);
  }

  @Post('runs/list')
  @RequirePermissions('agents.read')
  @HttpCode(200)
  runs(@Body() body: AgentPageDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.agents.runDirectory(request.auth!, body), request.requestId);
  }

  @Post('runs/get')
  @RequirePermissions('agents.read')
  @HttpCode(200)
  run(@Body() body: RecordIdDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.agents.runRecord(request.auth!, body.id), request.requestId);
  }

  @Post('runs/create')
  @RequirePermissions('agents.manage')
  @HttpCode(201)
  createRun(@Body() body: RunCreateDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.agents.createRun(request.auth!, body, request.requestId), request.requestId);
  }

  @Post('runs/cancel')
  @RequirePermissions('automation.pause')
  @HttpCode(200)
  cancelRun(@Body() body: RecordIdDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.agents.cancelRun(request.auth!, body.id, request.requestId), request.requestId);
  }

  @Post('runs/pause')
  @RequirePermissions('automation.pause')
  @HttpCode(200)
  pauseRun(@Body() body: RecordIdDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.agents.pauseRun(request.auth!, body.id, request.requestId), request.requestId);
  }

  @Post('runs/resume')
  @RequirePermissions('automation.pause')
  @HttpCode(200)
  resumeRun(@Body() body: RecordIdDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.agents.resumeRun(request.auth!, body.id, request.requestId), request.requestId);
  }

  @Post('runs/archive')
  @RequirePermissions('agents.manage')
  @HttpCode(200)
  archiveRun(@Body() body: RecordIdDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.agents.archiveRun(request.auth!, body.id, request.requestId), request.requestId);
  }

  @Post('runs/replay')
  @RequirePermissions('agents.manage')
  @HttpCode(201)
  replayRun(@Body() body: RecordIdDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.agents.replayRun(request.auth!, body.id, request.requestId), request.requestId);
  }

  @Post('runs/bulk-cancel')
  @RequirePermissions('automation.pause')
  @HttpCode(200)
  bulkCancel(@Body() body: RecordIdsDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.agents.bulkCancelRuns(request.auth!, body.ids, request.requestId), request.requestId);
  }

  @Post('runs/bulk-archive')
  @RequirePermissions('agents.manage')
  @HttpCode(200)
  bulkArchiveRuns(@Body() body: RecordIdsDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.agents.bulkArchiveRuns(request.auth!, body.ids, request.requestId), request.requestId);
  }

  @Post('policies/list')
  @RequirePermissions('agents.read')
  @HttpCode(200)
  policies(@Body() body: AgentPageDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.agents.policyDirectory(request.auth!, body), request.requestId);
  }

  @Post('policies/create')
  @RequirePermissions('agents.manage')
  @HttpCode(201)
  createPolicy(@Body() body: PolicyCreateDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.agents.createPolicy(request.auth!, body, request.requestId), request.requestId);
  }

  @Post('policies/update')
  @RequirePermissions('agents.manage')
  @HttpCode(200)
  updatePolicy(@Body() body: PolicyChangeDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.agents.updatePolicy(request.auth!, body, request.requestId), request.requestId);
  }

  @Post('policies/archive')
  @RequirePermissions('agents.manage')
  @HttpCode(200)
  archivePolicy(@Body() body: RecordIdDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.agents.archivePolicy(request.auth!, body.id, request.requestId), request.requestId);
  }

  @Post('models/list')
  @RequirePermissions('agents.read')
  @HttpCode(200)
  models(@Body() body: AgentPageDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.agents.modelDirectory(request.auth!, body), request.requestId);
  }

  @Post('models/get')
  @RequirePermissions('agents.read')
  @HttpCode(200)
  model(@Body() body: RecordIdDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.agents.modelRecord(request.auth!, body.id), request.requestId);
  }

  @Post('models/create')
  @RequirePermissions('agents.manage')
  @HttpCode(201)
  createModel(@Body() body: ModelCreateDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.agents.createModel(request.auth!, body, request.requestId), request.requestId);
  }

  @Post('models/update')
  @RequirePermissions('agents.manage')
  @HttpCode(200)
  updateModel(@Body() body: ModelChangeDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.agents.updateModel(request.auth!, body, request.requestId), request.requestId);
  }

  @Post('models/test')
  @RequirePermissions('agents.manage')
  @HttpCode(200)
  testModel(@Body() body: RecordIdDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.agents.testModel(request.auth!, body.id, request.requestId), request.requestId);
  }

  @Post('approvals/list')
  @HttpCode(200)
  approvals(@Body() body: AgentPageDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.agents.approvalDirectory(request.auth!, body), request.requestId);
  }

  @Post('approvals/get')
  @HttpCode(200)
  approval(@Body() body: RecordIdDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.agents.approvalRecord(request.auth!, body.id), request.requestId);
  }

  @Post('approvals/decide')
  @HttpCode(200)
  decideApproval(@Body() body: ApprovalDecisionDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.agents.decideApproval(request.auth!, body, request.requestId), request.requestId);
  }

  @Post('automation/get')
  @RequirePermissions('agents.read')
  @HttpCode(200)
  automation(@Req() request: AuthenticatedRequest) {
    return this.ok(this.agents.automation(request.auth!), request.requestId);
  }

  @Post('automation/pause')
  @RequirePermissions('automation.pause')
  @HttpCode(200)
  pauseAutomation(@Req() request: AuthenticatedRequest) {
    return this.ok(this.agents.setAutomation(request.auth!, 'PAUSED', request.requestId), request.requestId);
  }

  @Post('automation/resume')
  @RequirePermissions('automation.pause')
  @HttpCode(200)
  resumeAutomation(@Req() request: AuthenticatedRequest) {
    return this.ok(this.agents.setAutomation(request.auth!, 'RUNNING', request.requestId), request.requestId);
  }

  private ok<T>(result: Promise<T> | T, requestId: string) {
    return Promise.resolve(result).then((data) => apiSuccess(data, requestId));
  }
}
