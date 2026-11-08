import { Body, Controller, Get, Headers, HttpCode, Inject, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { apiSuccess } from '@salesos/shared';
import { ApiException } from '../common/api.exception';
import type { RequestWithId } from '../common/request-context';
import { PermissionGuard, SessionGuard, type AuthenticatedRequest } from '../identity/auth.guard';
import { RequirePermissions } from '../identity/require-permissions';
import { AssignDto, ConnectionBodyDto, ConnectionChangeDto, CredentialDto, DraftDecisionDto, DraftPrepareDto, LinkDto, PhoneBodyDto, TemplateBodyDto, TemplateVersionDto, WhatsAppIdDto, WhatsAppPageDto } from './whatsapp.dto';
import { RedisService } from '../redis/redis.service';
import { WhatsAppService } from './whatsapp.service';

@Controller('webhooks/whatsapp')
export class WhatsAppWebhookController {
  constructor(
    @Inject(WhatsAppService) private readonly whatsapp: WhatsAppService,
    @Inject(RedisService) private readonly redis: RedisService,
  ) {}

  @Get()
  verify(
    @Query('hub.mode') mode: string | undefined,
    @Query('hub.verify_token') token: string | undefined,
    @Query('hub.challenge') challenge: string | undefined,
    @Res() response: Response,
  ) {
    const value = this.whatsapp.handshake({ mode, token, challenge });
    if (!value) {
      response.status(403).type('text/plain').send('rejected');
      return;
    }
    response.status(200).type('text/plain').send(value);
  }

  @Post()
  @HttpCode(200)
  async receive(@Req() request: RequestWithId & { rawBody?: Buffer; ip?: string }, @Headers('x-hub-signature-256') signature?: string, @Headers('content-type') contentType?: string) {
    const decision = await this.redis.consumeWhatsAppWebhook(request.ip || 'unknown');
    if (decision === 'LIMITED') throw new ApiException(429, 'RATE_LIMITED', 'Webhook rate limit was reached');
    if (decision === 'UNAVAILABLE') throw new ApiException(503, 'WEBHOOK_UNAVAILABLE', 'Webhook rate limit is unavailable');
    const raw = request.rawBody ?? Buffer.alloc(0);
    const result = await this.whatsapp.receive(raw, signature, contentType);
    return apiSuccess(result, request.requestId);
  }
}

@Controller('management/whatsapp')
@UseGuards(SessionGuard, PermissionGuard)
export class WhatsAppController {
  constructor(@Inject(WhatsAppService) private readonly whatsapp: WhatsAppService) {}

  @Post('overview') @HttpCode(200) @RequirePermissions('whatsapp.conversations.read')
  overview(@Req() request: AuthenticatedRequest) { return this.ok(this.whatsapp.overview(request.auth!), request.requestId); }

  @Post('connections/list') @HttpCode(200) @RequirePermissions('whatsapp.connections.read')
  connections(@Body() body: WhatsAppPageDto, @Req() request: AuthenticatedRequest) { return this.ok(this.whatsapp.connections(request.auth!, body), request.requestId); }

  @Post('connections/create') @HttpCode(200) @RequirePermissions('whatsapp.connections.manage')
  create(@Body() body: ConnectionBodyDto, @Req() request: AuthenticatedRequest) { return this.ok(this.whatsapp.createConnection(request.auth!, body), request.requestId); }

  @Post('connections/update') @HttpCode(200) @RequirePermissions('whatsapp.connections.manage')
  update(@Body() body: ConnectionChangeDto, @Req() request: AuthenticatedRequest) { return this.ok(this.whatsapp.updateConnection(request.auth!, body.id, body), request.requestId); }

  @Post('connections/disable') @HttpCode(200) @RequirePermissions('whatsapp.connections.manage')
  disable(@Body() body: WhatsAppIdDto, @Req() request: AuthenticatedRequest) { return this.ok(this.whatsapp.disable(request.auth!, body.id), request.requestId); }

  @Post('connections/rotate') @HttpCode(200) @RequirePermissions('whatsapp.connections.manage')
  rotate(@Body() body: CredentialDto, @Req() request: AuthenticatedRequest) { return this.ok(this.whatsapp.rotate(request.auth!, body.id, body.token), request.requestId); }

  @Post('phones/list') @HttpCode(200) @RequirePermissions('whatsapp.connections.read')
  phones(@Body() body: WhatsAppPageDto, @Req() request: AuthenticatedRequest) { return this.ok(this.whatsapp.phones(request.auth!, body), request.requestId); }

  @Post('phones/create') @HttpCode(200) @RequirePermissions('whatsapp.connections.manage')
  addPhone(@Body() body: PhoneBodyDto, @Req() request: AuthenticatedRequest) { return this.ok(this.whatsapp.addPhone(request.auth!, body), request.requestId); }

  @Post('conversations/list') @HttpCode(200) @RequirePermissions('whatsapp.conversations.read')
  conversations(@Body() body: WhatsAppPageDto, @Req() request: AuthenticatedRequest) { return this.ok(this.whatsapp.conversations(request.auth!, body), request.requestId); }

  @Post('conversations/get') @HttpCode(200) @RequirePermissions('whatsapp.conversations.read')
  conversation(@Body() body: WhatsAppIdDto, @Req() request: AuthenticatedRequest) { return this.ok(this.whatsapp.conversation(request.auth!, body.id), request.requestId); }

  @Post('conversations/assign') @HttpCode(200) @RequirePermissions('whatsapp.conversations.manage')
  assign(@Body() body: AssignDto, @Req() request: AuthenticatedRequest) { return this.ok(this.whatsapp.assign(request.auth!, body.id, body), request.requestId); }

  @Post('conversations/link') @HttpCode(200) @RequirePermissions('whatsapp.conversations.manage')
  link(@Body() body: LinkDto, @Req() request: AuthenticatedRequest) { return this.ok(this.whatsapp.link(request.auth!, body.id, body), request.requestId); }

  @Post('drafts/prepare') @HttpCode(200) @RequirePermissions('whatsapp.drafts.create')
  prepare(@Body() body: DraftPrepareDto, @Req() request: AuthenticatedRequest) { return this.ok(this.whatsapp.prepare(request.auth!, body.id), request.requestId); }

  @Post('drafts/decide') @HttpCode(200) @RequirePermissions('whatsapp.drafts.review')
  decide(@Body() body: DraftDecisionDto, @Req() request: AuthenticatedRequest) { return this.ok(this.whatsapp.decide(request.auth!, body), request.requestId); }

  @Post('templates/list') @HttpCode(200) @RequirePermissions('whatsapp.templates.read')
  templates(@Body() body: WhatsAppPageDto, @Req() request: AuthenticatedRequest) { return this.ok(this.whatsapp.templates(request.auth!, body), request.requestId); }

  @Post('templates/create') @HttpCode(200) @RequirePermissions('whatsapp.templates.manage')
  createTemplate(@Body() body: TemplateBodyDto, @Req() request: AuthenticatedRequest) { return this.ok(this.whatsapp.createTemplate(request.auth!, body), request.requestId); }

  @Post('templates/version') @HttpCode(200) @RequirePermissions('whatsapp.templates.manage')
  version(@Body() body: TemplateVersionDto, @Req() request: AuthenticatedRequest) { return this.ok(this.whatsapp.addVersion(request.auth!, body), request.requestId); }

  @Post('alerts/list') @HttpCode(200) @RequirePermissions('whatsapp.operations.read')
  alerts(@Req() request: AuthenticatedRequest) { return this.ok(this.whatsapp.alerts(request.auth!), request.requestId); }

  @Post('alerts/acknowledge') @HttpCode(200) @RequirePermissions('whatsapp.operations.manage')
  acknowledge(@Body() body: WhatsAppIdDto, @Req() request: AuthenticatedRequest) { return this.ok(this.whatsapp.acknowledge(request.auth!, body.id), request.requestId); }

  @Post('events/list') @HttpCode(200) @RequirePermissions('whatsapp.operations.read')
  events(@Req() request: AuthenticatedRequest) { return this.ok(this.whatsapp.events(request.auth!), request.requestId); }

  @Post('events/process') @HttpCode(200) @RequirePermissions('whatsapp.operations.manage')
  process(@Req() request: AuthenticatedRequest) { return this.ok(this.whatsapp.processPending(request.auth!), request.requestId); }

  private ok<T>(value: Promise<T>, requestId: string) {
    return value.then((data) => apiSuccess(data, requestId));
  }
}
