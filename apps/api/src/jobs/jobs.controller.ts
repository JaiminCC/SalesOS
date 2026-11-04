import { Body, Controller, Headers, HttpCode, Inject, Post, Req, UnauthorizedException } from '@nestjs/common';
import { apiSuccess } from '@salesos/shared';
import { AppConfig } from '../config/app-config';
import type { RequestWithId } from '../common/request-context';
import { FoundationPingDto } from './foundation-ping.dto';
import { JobsService } from './jobs.service';

@Controller({ path: 'jobs', version: '1' })
export class JobsController {
  constructor(
    @Inject(JobsService) private readonly jobs: JobsService,
    @Inject(AppConfig) private readonly config: AppConfig,
  ) {}

  @Post('foundation-ping')
  @HttpCode(202)
  async foundationPing(
    @Body() body: FoundationPingDto,
    @Headers('authorization') authorization: string | undefined,
    @Req() req: RequestWithId,
  ) {
    if (!this.jobs.assertToken(authorization, this.config.env.INTERNAL_JOB_TOKEN)) {
      throw new UnauthorizedException('Internal job token is required');
    }
    const result = await this.jobs.enqueue({
      tenantId: body.tenantId,
      idempotencyKey: body.idempotencyKey,
      mode: body.mode ?? 'ok',
    });
    return apiSuccess(result, req.requestId ?? 'job');
  }
}
