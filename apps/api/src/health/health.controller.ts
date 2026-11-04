import { Controller, Get, Inject, Req, Res, VERSION_NEUTRAL } from '@nestjs/common';
import type { Response } from 'express';
import { apiError, apiSuccess } from '@salesos/shared';
import type { RequestWithId } from '../common/request-context';
import { HealthService } from './health.service';

function readyBody(report: Awaited<ReturnType<HealthService['ready']>>, requestId: string) {
  const healthy = report.postgres === 'up' && report.redis === 'up';
  if (!healthy) return { status: 503, body: apiError('NOT_READY', 'Dependencies are unavailable', requestId, report) };
  return { status: 200, body: apiSuccess(report, requestId) };
}

@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthProbeController {
  constructor(@Inject(HealthService) private readonly health: HealthService) {}

  @Get('live')
  live(@Req() req: RequestWithId) {
    return apiSuccess(this.health.live(), req.requestId ?? 'probe');
  }

  @Get('ready')
  async ready(@Req() req: RequestWithId, @Res({ passthrough: true }) res: Response) {
    const result = readyBody(await this.health.ready(), req.requestId ?? 'probe');
    res.status(result.status);
    return result.body;
  }
}

@Controller({ path: 'v1/health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(@Inject(HealthService) private readonly health: HealthService) {}

  @Get('live')
  live(@Req() req: RequestWithId) {
    return apiSuccess(this.health.live(), req.requestId ?? 'probe');
  }

  @Get('ready')
  async ready(@Req() req: RequestWithId, @Res({ passthrough: true }) res: Response) {
    const result = readyBody(await this.health.ready(), req.requestId ?? 'probe');
    res.status(result.status);
    return result.body;
  }
}
