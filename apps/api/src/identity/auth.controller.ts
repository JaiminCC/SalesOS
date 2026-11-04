import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { apiSuccess } from '@salesos/shared';
import { AppConfig } from '../config/app-config';
import { LoginDto, RegisterDto, ResetPasswordDto, TokenDto, EmailDto } from './auth.dto';
import { SessionGuard, type AuthenticatedRequest } from './auth.guard';
import { IdentityService } from './identity.service';
import { clearSessionCookie, readSessionCookie, writeSessionCookie } from './session-cookie';
import { UseGuards } from '@nestjs/common';

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(IdentityService) private readonly identity: IdentityService,
    @Inject(AppConfig) private readonly config: AppConfig,
  ) {}

  @Post('register')
  @HttpCode(202)
  async register(@Body() body: RegisterDto, @Req() request: AuthenticatedRequest) {
    await this.identity.register({ ...body, requestId: request.requestId });
    return apiSuccess({ accepted: true }, request.requestId);
  }

  @Post('login')
  @HttpCode(200)
  async login(@Body() body: LoginDto, @Req() request: AuthenticatedRequest, @Res({ passthrough: true }) response: Response) {
    const result = await this.identity.login({
      email: body.email,
      password: body.password,
      remember: body.remember ?? false,
      requestId: request.requestId,
      ip: request.ip ?? 'unknown',
      userAgent: request.header('user-agent'),
      presentedToken: readSessionCookie(request.headers.cookie),
    });
    response.setHeader('Set-Cookie', writeSessionCookie(result.token, body.remember ?? false, this.secure));
    return apiSuccess(publicSession(result.session), request.requestId);
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() request: AuthenticatedRequest, @Res({ passthrough: true }) response: Response) {
    await this.identity.logout(readSessionCookie(request.headers.cookie), request.requestId);
    response.setHeader('Set-Cookie', clearSessionCookie(this.secure));
  }

  @Post('forgot-password')
  @HttpCode(202)
  async forgot(@Body() body: EmailDto, @Req() request: AuthenticatedRequest) {
    await this.identity.forgotPassword(body.email, request.requestId);
    return apiSuccess({ accepted: true }, request.requestId);
  }

  @Post('reset-password')
  @HttpCode(204)
  async reset(@Body() body: ResetPasswordDto, @Req() request: AuthenticatedRequest) {
    await this.identity.resetPassword(body.token, body.password, request.requestId);
  }

  @Post('verify-email')
  @HttpCode(204)
  async verify(@Body() body: TokenDto, @Req() request: AuthenticatedRequest) {
    await this.identity.verifyEmail(body.token, request.requestId);
  }

  @Get('me')
  @UseGuards(SessionGuard)
  me(@Req() request: AuthenticatedRequest) {
    return apiSuccess(publicSession(request.auth!), request.requestId);
  }

  @Get('me/permissions')
  @UseGuards(SessionGuard)
  permissions(@Req() request: AuthenticatedRequest) {
    return apiSuccess({ permissions: request.auth!.permissions, roles: request.auth!.roles }, request.requestId);
  }

  @Get('sessions')
  @UseGuards(SessionGuard)
  async sessions(@Req() request: AuthenticatedRequest) {
    return apiSuccess(await this.identity.listSessions(request.auth!.userId, request.auth!.sessionId), request.requestId);
  }

  @Delete('sessions/:id')
  @UseGuards(SessionGuard)
  @HttpCode(204)
  async revoke(@Param('id', ParseUUIDPipe) id: string, @Req() request: AuthenticatedRequest, @Res({ passthrough: true }) response: Response) {
    await this.identity.revokeSession(request.auth!.userId, id, request.requestId, request.auth!.tenantId);
    if (id === request.auth!.sessionId) response.setHeader('Set-Cookie', clearSessionCookie(this.secure));
  }

  private get secure(): boolean {
    return this.config.env.NODE_ENV === 'production';
  }
}

function publicSession(session: { userId: string; sessionId: string; email: string; displayName: string; tenantId: string | null; permissions: string[]; roles: string[] }) {
  return {
    user: { id: session.userId, email: session.email, displayName: session.displayName },
    organizationId: session.tenantId,
    roles: session.roles,
    permissions: session.permissions,
    sessionId: session.sessionId,
  };
}
