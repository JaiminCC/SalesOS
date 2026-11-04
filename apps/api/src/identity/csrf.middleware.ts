import { Inject, Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Response } from 'express';
import { apiError } from '@salesos/shared';
import { AppConfig } from '../config/app-config';
import type { RequestWithId } from '../common/request-context';
import { readSessionCookie } from './session-cookie';

@Injectable()
export class CsrfMiddleware implements NestMiddleware {
  constructor(@Inject(AppConfig) private readonly config: AppConfig) {}

  use(request: RequestWithId, response: Response, next: NextFunction): void {
    const method = request.method.toUpperCase();
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) || !readSessionCookie(request.headers.cookie)) {
      next();
      return;
    }
    const allowed = this.config.env.WEB_ORIGIN.split(',').map((value) => value.trim()).filter(Boolean);
    if (request.header('x-salesos-csrf') === '1' && originAllowed(request.header('origin'), allowed)) {
      next();
      return;
    }
    response.status(403).json(apiError('CSRF_REJECTED', 'Cross-site request was rejected', request.requestId));
  }
}

function originAllowed(origin: string | undefined, allowed: string[]): boolean {
  if (!origin) return true;
  if (origin === 'null') return false;
  try {
    const parsed = new URL(origin);
    return parsed.origin === origin && allowed.includes(parsed.origin);
  } catch {
    return false;
  }
}
