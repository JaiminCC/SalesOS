import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiException } from '../common/api.exception';
import type { RequestWithId } from '../common/request-context';
import { IdentityService, type SessionContext } from './identity.service';
import { readSessionCookie } from './session-cookie';

export const PERMISSIONS_KEY = 'salesos_permissions';

export type AuthenticatedRequest = RequestWithId & { auth?: SessionContext };

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(@Inject(IdentityService) private readonly identity: IdentityService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    request.auth = await this.identity.context(readSessionCookie(request.headers.cookie));
    return true;
  }
}

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [context.getHandler(), context.getClass()]) ?? [];
    if (!required.length) return true;
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (required.every((permission) => request.auth?.permissions.includes(permission))) return true;
    throw new ApiException(403, 'FORBIDDEN', 'You do not have permission for this action');
  }
}
