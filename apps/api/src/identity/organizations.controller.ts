import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { apiSuccess } from '@salesos/shared';
import { CreateOrganizationDto, InvitationDto, TokenDto, UpdateMemberDto, UpdateOrganizationDto } from './auth.dto';
import { PermissionGuard, SessionGuard, type AuthenticatedRequest } from './auth.guard';
import { IdentityService } from './identity.service';
import { RequirePermissions } from './require-permissions';
import { IsString, IsUUID, MinLength } from 'class-validator';

class TransferOwnerDto {
  @IsUUID()
  userId!: string;

  @IsString()
  @MinLength(12)
  password!: string;
}

@Controller()
@UseGuards(SessionGuard, PermissionGuard)
export class OrganizationsController {
  constructor(@Inject(IdentityService) private readonly identity: IdentityService) {}

  @Post('organizations')
  @HttpCode(201)
  async create(@Body() body: CreateOrganizationDto, @Req() request: AuthenticatedRequest) {
    return apiSuccess(await this.identity.createAdditionalOrganization(request.auth!, body.name, request.requestId), request.requestId);
  }

  @Get('organizations')
  async list(@Req() request: AuthenticatedRequest) {
    return apiSuccess(await this.identity.organizations(request.auth!.userId), request.requestId);
  }

  @Get('organizations/:id')
  async get(@Param('id', ParseUUIDPipe) id: string, @Req() request: AuthenticatedRequest) {
    return apiSuccess(await this.identity.organization(request.auth!.userId, id), request.requestId);
  }

  @Patch('organizations/:id')
  @RequirePermissions('organizations.manage')
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateOrganizationDto, @Req() request: AuthenticatedRequest) {
    return apiSuccess(await this.identity.updateOrganization(request.auth!, id, body, request.requestId), request.requestId);
  }

  @Post('organizations/:id/switch')
  @HttpCode(204)
  async switchOrg(@Param('id', ParseUUIDPipe) id: string, @Req() request: AuthenticatedRequest) {
    await this.identity.switchOrganization(request.auth!, id, request.requestId);
  }

  @Post('organizations/:id/invitations')
  @RequirePermissions('users.invite')
  @HttpCode(202)
  async invite(@Param('id', ParseUUIDPipe) id: string, @Body() body: InvitationDto, @Req() request: AuthenticatedRequest) {
    await this.identity.invite(request.auth!, id, body.email, body.role, request.requestId);
    return apiSuccess({ accepted: true }, request.requestId);
  }

  @Post('invitations/accept')
  @HttpCode(200)
  async accept(@Body() body: TokenDto, @Req() request: AuthenticatedRequest) {
    return apiSuccess(await this.identity.acceptInvitation(request.auth!, body.token, request.requestId), request.requestId);
  }

  @Get('organizations/:id/members')
  async members(@Param('id', ParseUUIDPipe) id: string, @Req() request: AuthenticatedRequest) {
    return apiSuccess(await this.identity.members(request.auth!, id), request.requestId);
  }

  @Patch('organizations/:id/members/:userId')
  @RequirePermissions('roles.manage')
  @HttpCode(204)
  async updateMember(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() body: UpdateMemberDto,
    @Req() request: AuthenticatedRequest,
  ) {
    await this.identity.updateMember(request.auth!, id, userId, body.role, request.requestId);
  }

  @Delete('organizations/:id/members/:userId')
  @RequirePermissions('users.manage')
  @HttpCode(204)
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    await this.identity.removeMember(request.auth!, id, userId, request.requestId);
  }

  @Post('organizations/:id/owner-transfer')
  @HttpCode(204)
  async transfer(@Param('id', ParseUUIDPipe) id: string, @Body() body: TransferOwnerDto, @Req() request: AuthenticatedRequest) {
    await this.identity.transferOwner(request.auth!, id, body.userId, body.password, request.requestId);
  }

  @Get('organizations/:id/audit')
  async audit(@Param('id', ParseUUIDPipe) id: string, @Req() request: AuthenticatedRequest) {
    return apiSuccess(await this.identity.auditLog(request.auth!, id), request.requestId);
  }

  @Get('roles')
  async roles(@Req() request: AuthenticatedRequest) {
    return apiSuccess(await this.identity.roles(request.auth!), request.requestId);
  }

  @Get('permissions')
  permissions(@Req() request: AuthenticatedRequest) {
    return apiSuccess(this.identity.permissionCatalog(request.auth!), request.requestId);
  }
}
