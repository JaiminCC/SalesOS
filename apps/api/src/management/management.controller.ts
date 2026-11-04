import { Body, Controller, HttpCode, Inject, Post, Req, UseGuards } from '@nestjs/common';
import { apiSuccess } from '@salesos/shared';
import { ApiException } from '../common/api.exception';
import { CreateOrganizationDto, InvitationDto } from '../identity/auth.dto';
import { PermissionGuard, SessionGuard, type AuthenticatedRequest } from '../identity/auth.guard';
import { IdentityService } from '../identity/identity.service';
import { RequirePermissions } from '../identity/require-permissions';
import { CreateProductDto, ListProductsQuery, ProductDefaultsDto } from '../products/products.dto';
import { ProductsService } from '../products/products.service';
import {
  AuditListDto,
  IcpChangeDto,
  IcpCreateDto,
  KnowledgeDecisionDto,
  KnowledgeListDto,
  KnowledgeUploadDto,
  MemberChangeDto,
  MemberListDto,
  OrganizationListDto,
  PageDto,
  OrganizationChangeDto,
  ProductChangeDto,
  ProductChildDto,
  ProductParentDto,
  ProductRecordDto,
  ProductRecordsDto,
  RecordIdDto,
  RecordIdsDto,
  VersionActionDto,
  VersionChangeDto,
} from './management.dto';

@Controller('management')
@UseGuards(SessionGuard, PermissionGuard)
export class ManagementController {
  constructor(
    @Inject(IdentityService) private readonly identity: IdentityService,
    @Inject(ProductsService) private readonly products: ProductsService,
  ) {}

  @Post('members/list')
  @HttpCode(200)
  members(@Body() body: MemberListDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.identity.memberDirectory(request.auth!, body), request.requestId);
  }

  @Post('members/get')
  @HttpCode(200)
  member(@Body() body: RecordIdDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.identity.memberRecord(request.auth!, body.id), request.requestId);
  }

  @Post('members/invite')
  @RequirePermissions('users.invite')
  @HttpCode(202)
  async invite(@Body() body: InvitationDto, @Req() request: AuthenticatedRequest) {
    await this.identity.invite(request.auth!, this.tenant(request), body.email, body.role, request.requestId);
    return apiSuccess({ accepted: true }, request.requestId);
  }

  @Post('members/update')
  @RequirePermissions('roles.manage')
  @HttpCode(204)
  async updateMember(@Body() body: MemberChangeDto, @Req() request: AuthenticatedRequest) {
    await this.identity.updateMember(request.auth!, this.tenant(request), body.userId, body.role, request.requestId);
  }

  @Post('members/remove')
  @RequirePermissions('users.manage')
  @HttpCode(204)
  async removeMember(@Body() body: RecordIdDto, @Req() request: AuthenticatedRequest) {
    await this.identity.removeMember(request.auth!, this.tenant(request), body.id, request.requestId);
  }

  @Post('members/bulk-remove')
  @RequirePermissions('users.manage')
  @HttpCode(200)
  bulkRemoveMembers(@Body() body: RecordIdsDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.identity.bulkRemoveMembers(request.auth!, body.ids, request.requestId), request.requestId);
  }

  @Post('organizations/create')
  @HttpCode(201)
  createOrganization(@Body() body: CreateOrganizationDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.identity.createAdditionalOrganization(request.auth!, body.name, request.requestId), request.requestId);
  }

  @Post('organizations/list')
  @HttpCode(200)
  organizations(@Body() body: OrganizationListDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.identity.organizationDirectory(request.auth!, body), request.requestId);
  }

  @Post('organizations/get')
  @HttpCode(200)
  organization(@Body() body: RecordIdDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.identity.organization(request.auth!.userId, body.id), request.requestId);
  }

  @Post('organizations/update')
  @RequirePermissions('organizations.manage')
  @HttpCode(200)
  updateOrganization(@Body() body: OrganizationChangeDto, @Req() request: AuthenticatedRequest) {
    if (body.id !== this.tenant(request)) throw new ApiException(404, 'NOT_FOUND', 'Organization was not found');
    return this.ok(this.identity.updateOrganization(request.auth!, body.id, { name: body.name, status: body.status }, request.requestId), request.requestId);
  }

  @Post('roles/list')
  @HttpCode(200)
  roles(@Req() request: AuthenticatedRequest) {
    return this.ok(this.identity.roles(request.auth!), request.requestId);
  }

  @Post('invitations/list')
  @HttpCode(200)
  invitations(@Body() body: PageDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.identity.invitationDirectory(request.auth!, body), request.requestId);
  }

  @Post('invitations/revoke')
  @HttpCode(204)
  async revokeInvitation(@Body() body: RecordIdDto, @Req() request: AuthenticatedRequest) {
    await this.identity.revokeInvitation(request.auth!, body.id, request.requestId);
  }

  @Post('invitations/bulk-revoke')
  @HttpCode(200)
  bulkRevokeInvitations(@Body() body: RecordIdsDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.identity.bulkRevokeInvitations(request.auth!, body.ids, request.requestId), request.requestId);
  }

  @Post('sessions/list')
  @HttpCode(200)
  sessions(@Body() body: PageDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.identity.sessionDirectory(request.auth!, body), request.requestId);
  }

  @Post('sessions/revoke')
  @HttpCode(204)
  async revokeSession(@Body() body: RecordIdDto, @Req() request: AuthenticatedRequest) {
    await this.identity.revokeSession(request.auth!.userId, body.id, request.requestId, request.auth!.tenantId);
  }

  @Post('sessions/bulk-revoke')
  @HttpCode(200)
  bulkRevokeSessions(@Body() body: RecordIdsDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.identity.bulkRevokeSessions(request.auth!, body.ids, request.requestId), request.requestId);
  }

  @Post('audit/list')
  @HttpCode(200)
  audit(@Body() body: AuditListDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.identity.auditDirectory(request.auth!, body), request.requestId);
  }

  @Post('products/list')
  @RequirePermissions('products.read')
  @HttpCode(200)
  listProducts(@Body() body: ListProductsQuery, @Req() request: AuthenticatedRequest) {
    return this.ok(this.products.list(request.auth!, body), request.requestId);
  }

  @Post('products/get')
  @RequirePermissions('products.read')
  @HttpCode(200)
  product(@Body() body: RecordIdDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.products.get(request.auth!, body.id), request.requestId);
  }

  @Post('products/create')
  @RequirePermissions('products.write')
  @HttpCode(201)
  createProduct(@Body() body: CreateProductDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.products.create(request.auth!, body, request.requestId), request.requestId);
  }

  @Post('products/update')
  @RequirePermissions('products.write')
  @HttpCode(200)
  updateProduct(@Body() body: ProductChangeDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.products.update(request.auth!, body.id, body, request.requestId), request.requestId);
  }

  @Post('products/archive')
  @RequirePermissions('products.write')
  @HttpCode(200)
  archiveProduct(@Body() body: RecordIdDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.products.archive(request.auth!, body.id, request.requestId), request.requestId);
  }

  @Post('products/restore')
  @RequirePermissions('products.write')
  @HttpCode(200)
  restoreProduct(@Body() body: RecordIdDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.products.restore(request.auth!, body.id, request.requestId), request.requestId);
  }

  @Post('products/duplicate')
  @RequirePermissions('products.write')
  @HttpCode(201)
  duplicateProduct(@Body() body: RecordIdDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.products.duplicate(request.auth!, body.id, request.requestId), request.requestId);
  }

  @Post('products/bulk-archive')
  @RequirePermissions('products.write')
  @HttpCode(200)
  bulkArchive(@Body() body: RecordIdsDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.products.bulkArchive(request.auth!, body.ids, request.requestId), request.requestId);
  }

  @Post('products/bulk-restore')
  @RequirePermissions('products.write')
  @HttpCode(200)
  bulkRestore(@Body() body: RecordIdsDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.products.bulkRestore(request.auth!, body.ids, request.requestId), request.requestId);
  }

  @Post('versions/list')
  @RequirePermissions('products.read')
  @HttpCode(200)
  versions(@Body() body: ProductChildDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.products.versionPage(request.auth!, body.productId, body), request.requestId);
  }

  @Post('versions/get')
  @RequirePermissions('products.read')
  @HttpCode(200)
  version(@Body() body: ProductRecordDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.products.getVersion(request.auth!, body.productId, body.id), request.requestId);
  }

  @Post('versions/create')
  @RequirePermissions('products.write')
  @HttpCode(201)
  createVersion(@Body() body: ProductParentDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.products.createVersion(request.auth!, body.productId, request.requestId), request.requestId);
  }

  @Post('versions/update')
  @RequirePermissions('products.write')
  @HttpCode(200)
  updateVersion(@Body() body: VersionChangeDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.products.updateVersion(request.auth!, body.productId, body.id, body, request.requestId), request.requestId);
  }

  @Post('versions/submit')
  @RequirePermissions('products.write')
  @HttpCode(200)
  submitVersion(@Body() body: VersionActionDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.products.transition(request.auth!, body.productId, body.id, 'IN_REVIEW', request.requestId), request.requestId);
  }

  @Post('versions/approve')
  @RequirePermissions('approvals.manage')
  @HttpCode(200)
  approveVersion(@Body() body: VersionActionDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.products.transition(request.auth!, body.productId, body.id, 'APPROVED', request.requestId), request.requestId);
  }

  @Post('versions/reject')
  @RequirePermissions('approvals.manage')
  @HttpCode(200)
  rejectVersion(@Body() body: VersionActionDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.products.transition(request.auth!, body.productId, body.id, 'REJECTED', request.requestId, body.reason), request.requestId);
  }

  @Post('versions/publish')
  @RequirePermissions('products.publish')
  @HttpCode(200)
  publishVersion(@Body() body: VersionActionDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.products.transition(request.auth!, body.productId, body.id, 'PUBLISHED', request.requestId), request.requestId);
  }

  @Post('versions/archive')
  @RequirePermissions('products.write')
  @HttpCode(200)
  archiveVersion(@Body() body: VersionActionDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.products.transition(request.auth!, body.productId, body.id, 'ARCHIVED', request.requestId), request.requestId);
  }

  @Post('versions/restore')
  @RequirePermissions('products.write')
  @HttpCode(201)
  restoreVersion(@Body() body: VersionActionDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.products.restoreVersion(request.auth!, body.productId, body.id, request.requestId), request.requestId);
  }

  @Post('icps/list')
  @RequirePermissions('products.read')
  @HttpCode(200)
  icps(@Body() body: ProductChildDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.products.icpPage(request.auth!, body.productId, body), request.requestId);
  }

  @Post('icps/get')
  @RequirePermissions('products.read')
  @HttpCode(200)
  icp(@Body() body: ProductRecordDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.products.getIcp(request.auth!, body.productId, body.id), request.requestId);
  }

  @Post('icps/create')
  @RequirePermissions('products.write')
  @HttpCode(201)
  createIcp(@Body() body: IcpCreateDto, @Req() request: AuthenticatedRequest) {
    const { productId, ...icp } = body;
    return this.ok(this.products.addIcp(request.auth!, productId, icp, request.requestId), request.requestId);
  }

  @Post('icps/update')
  @RequirePermissions('products.write')
  @HttpCode(200)
  updateIcp(@Body() body: IcpChangeDto, @Req() request: AuthenticatedRequest) {
    const { productId, id, ...icp } = body;
    return this.ok(this.products.updateIcp(request.auth!, productId, id, icp, request.requestId), request.requestId);
  }

  @Post('icps/archive')
  @RequirePermissions('products.write')
  @HttpCode(200)
  archiveIcp(@Body() body: ProductRecordDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.products.archiveIcp(request.auth!, body.productId, body.id, request.requestId), request.requestId);
  }

  @Post('icps/duplicate')
  @RequirePermissions('products.write')
  @HttpCode(201)
  duplicateIcp(@Body() body: ProductRecordDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.products.duplicateIcp(request.auth!, body.productId, body.id, request.requestId), request.requestId);
  }

  @Post('icps/bulk-archive')
  @RequirePermissions('products.write')
  @HttpCode(200)
  bulkArchiveIcps(@Body() body: ProductRecordsDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.products.bulkArchiveIcps(request.auth!, body.productId, body.ids, request.requestId), request.requestId);
  }

  @Post('knowledge/list')
  @RequirePermissions('products.read')
  @HttpCode(200)
  knowledge(@Body() body: KnowledgeListDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.products.documentPage(request.auth!, body.productId, body), request.requestId);
  }

  @Post('knowledge/get')
  @RequirePermissions('products.read')
  @HttpCode(200)
  knowledgeDocument(@Body() body: ProductRecordDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.products.document(request.auth!, body.productId, body.id), request.requestId);
  }

  @Post('knowledge/upload')
  @RequirePermissions('products.write')
  @HttpCode(201)
  uploadKnowledge(@Body() body: KnowledgeUploadDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.products.upload(request.auth!, body.productId, body, request.requestId), request.requestId);
  }

  @Post('knowledge/approve')
  @RequirePermissions('approvals.manage')
  @HttpCode(200)
  approveKnowledge(@Body() body: KnowledgeDecisionDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.products.reviewDocument(request.auth!, body.productId, body.id, 'APPROVED', request.requestId), request.requestId);
  }

  @Post('knowledge/reject')
  @RequirePermissions('approvals.manage')
  @HttpCode(200)
  rejectKnowledge(@Body() body: KnowledgeDecisionDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.products.reviewDocument(request.auth!, body.productId, body.id, 'REJECTED', request.requestId, body.reason), request.requestId);
  }

  @Post('knowledge/retry')
  @RequirePermissions('products.write')
  @HttpCode(200)
  retryKnowledge(@Body() body: ProductRecordDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.products.reprocess(request.auth!, body.productId, body.id, request.requestId, true), request.requestId);
  }

  @Post('knowledge/reprocess')
  @RequirePermissions('products.write')
  @HttpCode(200)
  reprocessKnowledge(@Body() body: ProductRecordDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.products.reprocess(request.auth!, body.productId, body.id, request.requestId, false), request.requestId);
  }

  @Post('knowledge/delete')
  @RequirePermissions('products.write')
  @HttpCode(204)
  async deleteKnowledge(@Body() body: ProductRecordDto, @Req() request: AuthenticatedRequest) {
    await this.products.removeDocument(request.auth!, body.productId, body.id, request.requestId);
  }

  @Post('knowledge/bulk-delete')
  @RequirePermissions('products.write')
  @HttpCode(200)
  bulkDeleteKnowledge(@Body() body: ProductRecordsDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.products.bulkRemoveDocuments(request.auth!, body.productId, body.ids, request.requestId), request.requestId);
  }

  @Post('knowledge/bulk-approve')
  @RequirePermissions('approvals.manage')
  @HttpCode(200)
  bulkApproveKnowledge(@Body() body: ProductRecordsDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.products.bulkApproveDocuments(request.auth!, body.productId, body.ids, request.requestId), request.requestId);
  }

  @Post('defaults/get')
  @RequirePermissions('products.read')
  @HttpCode(200)
  defaults(@Req() request: AuthenticatedRequest) {
    return this.ok(this.products.defaults(request.auth!), request.requestId);
  }

  @Post('defaults/update')
  @RequirePermissions('products.write')
  @HttpCode(200)
  updateDefaults(@Body() body: ProductDefaultsDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.products.updateDefaults(request.auth!, body, request.requestId), request.requestId);
  }

  private ok<T>(work: Promise<T>, requestId: string) {
    return work.then((data) => apiSuccess(data, requestId));
  }

  private tenant(request: AuthenticatedRequest): string {
    if (!request.auth?.tenantId) throw new ApiException(409, 'ORGANIZATION_REQUIRED', 'Choose an organization first');
    return request.auth.tenantId;
  }
}
