import { Body, Controller, HttpCode, Inject, Post, Req, UseGuards } from '@nestjs/common';
import { apiSuccess } from '@salesos/shared';
import { PermissionGuard, SessionGuard, type AuthenticatedRequest } from '../identity/auth.guard';
import { CreateNavigationDto, ResolveNavigationDto } from './navigation.dto';
import { NavigationService } from './navigation.service';

@Controller('navigation/contexts')
@UseGuards(SessionGuard, PermissionGuard)
export class NavigationController {
  constructor(@Inject(NavigationService) private readonly navigation: NavigationService) {}

  @Post()
  @HttpCode(201)
  async create(@Body() body: CreateNavigationDto, @Req() request: AuthenticatedRequest) {
    return apiSuccess(await this.navigation.create(request.auth!, body), request.requestId);
  }

  @Post('resolve')
  @HttpCode(200)
  async resolve(@Body() body: ResolveNavigationDto, @Req() request: AuthenticatedRequest) {
    return apiSuccess(await this.navigation.resolve(request.auth!, body.token), request.requestId);
  }
}
