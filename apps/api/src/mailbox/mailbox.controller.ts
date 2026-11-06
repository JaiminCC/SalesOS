import { Body, Controller, Get, Headers, HttpCode, Inject, Param, Post, Query, RawBodyRequest, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { apiSuccess } from '@salesos/shared';
import { PermissionGuard, SessionGuard, type AuthenticatedRequest } from '../identity/auth.guard';
import { RequirePermissions } from '../identity/require-permissions';
import {
  AnalyzeDto,
  CaptureMailboxDto,
  DraftBodyDto,
  DraftDecisionDto,
  IdDto,
  InvestigationDto,
  ImportMessagesDto,
  MailboxListDto,
  MailboxSendingDto,
  SyncPauseDto,
  OauthStartDto,
  SendPolicyDto,
  ThreadAssignDto,
  ThreadLinkDto,
  ThreadUnlinkDto,
} from './mailbox.dto';
import { MailboxConnectionService, MailboxHealthService, MailboxMessageService, MailboxSendService, MailboxSyncService, MailboxWebhookService } from './mailbox.service';

@Controller('management')
@UseGuards(SessionGuard, PermissionGuard)
export class MailboxController {
  constructor(
    @Inject(MailboxConnectionService) private readonly connections: MailboxConnectionService,
    @Inject(MailboxSyncService) private readonly syncService: MailboxSyncService,
    @Inject(MailboxMessageService) private readonly messages: MailboxMessageService,
    @Inject(MailboxSendService) private readonly sendService: MailboxSendService,
    @Inject(MailboxHealthService) private readonly health: MailboxHealthService,
  ) {}

  @Post('mailboxes/providers') @HttpCode(200) @RequirePermissions('mailbox.read')
  providers(@Req() request: AuthenticatedRequest) { return this.ok(this.connections.providers(), request.requestId); }

  @Post('mailboxes/health') @HttpCode(200) @RequirePermissions('mailbox.read')
  mailboxHealth(@Req() request: AuthenticatedRequest) { return this.ok(this.health.status(), request.requestId); }

  @Post('operations/overview') @HttpCode(200) @RequirePermissions('mailbox.operations.read')
  overview(@Req() request: AuthenticatedRequest) { return this.ok(this.health.overview(request.auth!), request.requestId); }

  @Post('operations/connections') @HttpCode(200) @RequirePermissions('mailbox.operations.read')
  operationConnections(@Body() body: MailboxListDto, @Req() request: AuthenticatedRequest) { return this.ok(this.health.connectionsList(request.auth!, body), request.requestId); }

  @Post('operations/get') @HttpCode(200) @RequirePermissions('mailbox.operations.read')
  operation(@Body() body: IdDto, @Req() request: AuthenticatedRequest) { return this.ok(this.health.connection(request.auth!, body.id), request.requestId); }

  @Post('operations/runs') @HttpCode(200) @RequirePermissions('mailbox.operations.read')
  runs(@Body() body: MailboxListDto, @Req() request: AuthenticatedRequest) { return this.ok(this.health.runs(request.auth!, body), request.requestId); }

  @Post('operations/errors') @HttpCode(200) @RequirePermissions('mailbox.operations.read')
  errors(@Body() body: MailboxListDto, @Req() request: AuthenticatedRequest) { return this.ok(this.health.errors(request.auth!, body), request.requestId); }

  @Post('operations/alerts') @HttpCode(200) @RequirePermissions('mailbox.health.read')
  alerts(@Body() body: MailboxListDto, @Req() request: AuthenticatedRequest) { return this.ok(this.health.alerts(request.auth!, body), request.requestId); }

  @Post('operations/alerts/acknowledge') @HttpCode(200) @RequirePermissions('mailbox.operations.manage')
  acknowledge(@Body() body: IdDto, @Req() request: AuthenticatedRequest) { return this.ok(this.health.acknowledge(request.auth!, body.id), request.requestId); }

  @Post('operations/pause') @HttpCode(200) @RequirePermissions('mailbox.operations.manage')
  pause(@Body() body: SyncPauseDto, @Req() request: AuthenticatedRequest) { return this.ok(this.health.pause(request.auth!, body.id, body.paused), request.requestId); }

  @Post('operations/recover-cursor') @HttpCode(200) @RequirePermissions('mailbox.sync.recover')
  recover(@Body() body: IdDto, @Req() request: AuthenticatedRequest) { return this.ok(this.health.recover(request.auth!, body.id), request.requestId); }

  @Post('mailboxes/list') @HttpCode(200) @RequirePermissions('mailbox.read')
  list(@Body() body: MailboxListDto, @Req() request: AuthenticatedRequest) { return this.ok(this.connections.listConnections(request.auth!, body), request.requestId); }

  @Post('mailboxes/get') @HttpCode(200) @RequirePermissions('mailbox.read')
  get(@Body() body: IdDto, @Req() request: AuthenticatedRequest) { return this.ok(this.connections.connection(request.auth!, body.id), request.requestId); }

  @Post('mailboxes/capture') @HttpCode(200) @RequirePermissions('mailbox.connect')
  capture(@Body() body: CaptureMailboxDto, @Req() request: AuthenticatedRequest) { return this.ok(this.connections.createCapture(request.auth!, body, request.requestId), request.requestId); }

  @Post('mailboxes/oauth/start') @HttpCode(200) @RequirePermissions('mailbox.connect')
  oauth(@Body() body: OauthStartDto, @Req() request: AuthenticatedRequest) { return this.ok(this.connections.startOauth(request.auth!, body), request.requestId); }

  @Post('mailboxes/oauth/send-start') @HttpCode(200) @RequirePermissions('mailbox.send.request')
  sendOauth(@Body() body: OauthStartDto, @Req() request: AuthenticatedRequest) { return this.ok(this.connections.startSendOauth(request.auth!, body), request.requestId); }

  @Post('mailboxes/disconnect') @HttpCode(200) @RequirePermissions('mailbox.connect')
  disconnect(@Body() body: IdDto, @Req() request: AuthenticatedRequest) { return this.ok(this.connections.disconnect(request.auth!, body.id, request.requestId), request.requestId); }

  @Post('mailbox-sync/run') @HttpCode(200) @RequirePermissions('mailbox.connect')
  sync(@Body() body: IdDto, @Req() request: AuthenticatedRequest) { return this.ok(this.syncService.sync(request.auth!, body.id), request.requestId); }

  @Post('mailbox-sync/import') @HttpCode(200) @RequirePermissions('mailbox.connect')
  importMessages(@Body() body: ImportMessagesDto, @Req() request: AuthenticatedRequest) { return this.ok(this.syncService.importMessages(request.auth!, body), request.requestId); }

  @Post('threads/list') @HttpCode(200) @RequirePermissions('mailbox.read')
  threads(@Body() body: MailboxListDto, @Req() request: AuthenticatedRequest) { return this.ok(this.messages.listThreads(request.auth!, body), request.requestId); }

  @Post('threads/get') @HttpCode(200) @RequirePermissions('mailbox.read')
  thread(@Body() body: IdDto, @Req() request: AuthenticatedRequest) { return this.ok(this.messages.thread(request.auth!, body.id), request.requestId); }

  @Post('threads/link') @HttpCode(200) @RequirePermissions('mailbox.draft')
  link(@Body() body: ThreadLinkDto, @Req() request: AuthenticatedRequest) { return this.ok(this.messages.link(request.auth!, body, request.requestId), request.requestId); }

  @Post('threads/unlink') @HttpCode(200) @RequirePermissions('mailbox.draft')
  unlink(@Body() body: ThreadUnlinkDto, @Req() request: AuthenticatedRequest) { return this.ok(this.messages.unlink(request.auth!, body, request.requestId), request.requestId); }

  @Post('threads/assign') @HttpCode(200) @RequirePermissions('mailbox.draft')
  assign(@Body() body: ThreadAssignDto, @Req() request: AuthenticatedRequest) { return this.ok(this.messages.assign(request.auth!, body), request.requestId); }

  @Post('drafts/list') @HttpCode(200) @RequirePermissions('mailbox.read')
  drafts(@Body() body: MailboxListDto, @Req() request: AuthenticatedRequest) { return this.ok(this.sendService.drafts(request.auth!, body), request.requestId); }

  @Post('drafts/get') @HttpCode(200) @RequirePermissions('mailbox.read')
  draft(@Body() body: IdDto, @Req() request: AuthenticatedRequest) { return this.ok(this.sendService.draft(request.auth!, body.id), request.requestId); }

  @Post('drafts/save') @HttpCode(200) @RequirePermissions('mailbox.draft')
  save(@Body() body: DraftBodyDto, @Req() request: AuthenticatedRequest) { return this.ok(this.sendService.save(request.auth!, body), request.requestId); }

  @Post('drafts/submit') @HttpCode(200) @RequirePermissions('mailbox.draft')
  submit(@Body() body: IdDto, @Req() request: AuthenticatedRequest) { return this.ok(this.sendService.submit(request.auth!, body.id), request.requestId); }

  @Post('email-approvals/decide') @HttpCode(200) @RequirePermissions('mailbox.review')
  decide(@Body() body: DraftDecisionDto, @Req() request: AuthenticatedRequest) { return this.ok(this.sendService.decide(request.auth!, body), request.requestId); }

  @Post('email-sending/status') @HttpCode(200) @RequirePermissions('mailbox.read')
  sendingStatus(@Req() request: AuthenticatedRequest) { return this.ok(this.sendService.status(request.auth!), request.requestId); }

  @Post('email-sending/policy') @HttpCode(200) @RequirePermissions('mailbox.send.manage')
  sendingPolicy(@Body() body: SendPolicyDto, @Req() request: AuthenticatedRequest) { return this.ok(this.sendService.setPolicy(request.auth!, body), request.requestId); }

  @Post('email-sending/mailbox') @HttpCode(200) @RequirePermissions('mailbox.send.manage')
  mailboxSending(@Body() body: MailboxSendingDto, @Req() request: AuthenticatedRequest) { return this.ok(this.sendService.setMailboxSending(request.auth!, body.id, body.sendingEnabled), request.requestId); }

  @Post('email-send/run') @HttpCode(200) @RequirePermissions('mailbox.send')
  send(@Body() body: IdDto, @Req() request: AuthenticatedRequest) { return this.ok(this.sendService.send(request.auth!, body.id), request.requestId); }

  @Post('delivery/list') @HttpCode(200) @RequirePermissions('mailbox.read')
  deliveries(@Body() body: MailboxListDto, @Req() request: AuthenticatedRequest) { return this.ok(this.sendService.deliveries(request.auth!, body), request.requestId); }

  @Post('delivery/get') @HttpCode(200) @RequirePermissions('mailbox.read')
  delivery(@Body() body: IdDto, @Req() request: AuthenticatedRequest) { return this.ok(this.sendService.delivery(request.auth!, body.id), request.requestId); }

  @Post('delivery/investigate') @HttpCode(200) @RequirePermissions('mailbox.send.review')
  investigate(@Body() body: InvestigationDto, @Req() request: AuthenticatedRequest) { return this.ok(this.sendService.investigate(request.auth!, body.id, body.note), request.requestId); }

  @Post('delivery/reconcile') @HttpCode(200) @RequirePermissions('mailbox.read')
  reconcile(@Body() body: IdDto, @Req() request: AuthenticatedRequest) { return this.ok(this.sendService.reconcile(request.auth!, body.id), request.requestId); }

  @Post('inbox-ai/run') @HttpCode(200) @RequirePermissions('mailbox.draft')
  analyze(@Body() body: AnalyzeDto, @Req() request: AuthenticatedRequest) { return this.ok(this.sendService.analyze(request.auth!, body, request.requestId), request.requestId); }

  private ok<T>(value: Promise<T> | T, requestId: string) {
    return Promise.resolve(value).then((data) => apiSuccess(data, requestId));
  }
}

@Controller('mailbox')
export class MailboxOauthController {
  constructor(
    @Inject(MailboxConnectionService) private readonly connections: MailboxConnectionService,
    @Inject(MailboxWebhookService) private readonly webhooks: MailboxWebhookService,
  ) {}

  @Get('oauth/callback')
  async callback(@Query('state') state: string, @Query('code') code: string | undefined, @Res() response: Response) {
    const result = await this.connections.completeOauth(state || '', code);
    response.redirect(result.location);
  }

  @Post('webhooks/:provider')
  @HttpCode(200)
  webhook(@Param('provider') provider: string, @Req() request: RawBodyRequest<Request>, @Headers('x-salesos-signature') signature?: string) {
    return this.webhooks.receive(provider, request.rawBody?.toString('utf8') ?? '', signature);
  }
}
