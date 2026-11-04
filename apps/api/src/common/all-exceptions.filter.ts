import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import { apiError } from '@salesos/shared';
import { logError } from '../logging/logger';
import type { RequestWithId } from './request-context';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<RequestWithId>();
    const requestId = request.requestId ?? 'unknown';
    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const code = codeFrom(exception, status);
    const message = exception instanceof HttpException ? messageFrom(exception.getResponse()) : 'Internal server error';
    const details = exception instanceof HttpException ? detailsFrom(exception.getResponse()) : undefined;
    if (status >= 500) {
      logError('request failed', {
        requestId,
        status,
        name: exception instanceof Error ? exception.name : 'Error',
      });
    }
    response.status(status).json(apiError(code, message, requestId, details));
  }
}

function codeFrom(exception: unknown, status: number): string {
  if (exception instanceof HttpException) {
    const body = exception.getResponse();
    if (body && typeof body === 'object' && 'code' in body && typeof (body as { code: unknown }).code === 'string') {
      return (body as { code: string }).code;
    }
  }
  if (status === 400) return 'VALIDATION_ERROR';
  if (status === 401) return 'UNAUTHORIZED';
  if (status === 403) return 'FORBIDDEN';
  if (status === 404) return 'NOT_FOUND';
  if (status === 409) return 'CONFLICT';
  if (status === 429) return 'AUTH_THROTTLED';
  if (status === 503) return 'NOT_READY';
  return 'INTERNAL';
}

function messageFrom(body: unknown): string {
  if (typeof body === 'string') return body;
  if (body && typeof body === 'object' && 'message' in body) {
    const message = (body as { message: unknown }).message;
    if (Array.isArray(message)) return message.map(String).join('; ');
    if (typeof message === 'string') return message;
  }
  return 'Request failed';
}

function detailsFrom(body: unknown): unknown {
  if (body && typeof body === 'object' && 'message' in body && Array.isArray((body as { message: unknown }).message)) {
    return (body as { message: unknown }).message;
  }
  return undefined;
}
