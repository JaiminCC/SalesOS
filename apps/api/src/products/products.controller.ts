import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req, StreamableFile, UseGuards } from '@nestjs/common';
import { apiSuccess } from '@salesos/shared';
import { ApiException } from '../common/api.exception';
import { PermissionGuard, SessionGuard, type AuthenticatedRequest } from '../identity/auth.guard';
import { RequirePermissions } from '../identity/require-permissions';
import {
  ContextPreviewDto,
  CreateProductDto,
  IcpBody,
  ListProductsQuery,
  ProductBody,
  ProductDefaultsDto,
  RejectDto,
  SearchKnowledgeDto,
  UpdateVersionDto,
  UploadDocumentDto,
} from './products.dto';
import { ProductsService } from './products.service';

@Controller('product-defaults')
@UseGuards(SessionGuard, PermissionGuard)
export class ProductDefaultsController {
  constructor(@Inject(ProductsService) private readonly products: ProductsService) {}

  @Get()
  @RequirePermissions('products.read')
  async get(@Req() request: AuthenticatedRequest) {
    return apiSuccess(await this.products.defaults(request.auth!), request.requestId);
  }

  @Put()
  @RequirePermissions('products.write')
  async update(@Body() body: ProductDefaultsDto, @Req() request: AuthenticatedRequest) {
    return apiSuccess(await this.products.updateDefaults(request.auth!, body, request.requestId), request.requestId);
  }
}

@Controller('products')
@UseGuards(SessionGuard, PermissionGuard)
export class ProductsController {
  constructor(@Inject(ProductsService) private readonly products: ProductsService) {}

  @Get()
  @RequirePermissions('products.read')
  async list(@Query() query: ListProductsQuery, @Req() request: AuthenticatedRequest) {
    return apiSuccess(await this.products.list(request.auth!, query), request.requestId);
  }

  @Post()
  @RequirePermissions('products.write')
  @HttpCode(201)
  async create(@Body() body: CreateProductDto, @Req() request: AuthenticatedRequest) {
    return apiSuccess(await this.products.create(request.auth!, body, request.requestId), request.requestId);
  }

  @Get(':id/activity')
  @RequirePermissions('products.read')
  async activity(@Param('id', ParseUUIDPipe) id: string, @Req() request: AuthenticatedRequest) {
    return apiSuccess(await this.products.activity(request.auth!, id), request.requestId);
  }

  @Get(':id/versions')
  @RequirePermissions('products.read')
  async versions(@Param('id', ParseUUIDPipe) id: string, @Req() request: AuthenticatedRequest) {
    return apiSuccess(await this.products.listVersions(request.auth!, id), request.requestId);
  }

  @Post(':id/versions')
  @RequirePermissions('products.write')
  @HttpCode(201)
  async createVersion(@Param('id', ParseUUIDPipe) id: string, @Req() request: AuthenticatedRequest) {
    return apiSuccess(await this.products.createVersion(request.auth!, id, request.requestId), request.requestId);
  }

  @Get(':id/versions/:versionId')
  @RequirePermissions('products.read')
  async version(@Param('id', ParseUUIDPipe) id: string, @Param('versionId', ParseUUIDPipe) versionId: string, @Req() request: AuthenticatedRequest) {
    return apiSuccess(await this.products.getVersion(request.auth!, id, versionId), request.requestId);
  }

  @Patch(':id/versions/:versionId')
  @RequirePermissions('products.write')
  async updateVersion(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('versionId', ParseUUIDPipe) versionId: string,
    @Body() body: UpdateVersionDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return apiSuccess(await this.products.updateVersion(request.auth!, id, versionId, body, request.requestId), request.requestId);
  }

  @Get(':id/versions/:versionId/compare')
  @RequirePermissions('products.read')
  async compare(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('versionId', ParseUUIDPipe) versionId: string,
    @Query('against') against: string,
    @Req() request: AuthenticatedRequest,
  ) {
    if (!/^[0-9a-f-]{36}$/i.test(against ?? '')) throw new ApiException(400, 'VALIDATION_ERROR', 'Compare requires a version id');
    return apiSuccess(await this.products.compare(request.auth!, id, versionId, against), request.requestId);
  }

  @Post(':id/versions/:versionId/submit')
  @RequirePermissions('products.write')
  @HttpCode(200)
  async submit(@Param('id', ParseUUIDPipe) id: string, @Param('versionId', ParseUUIDPipe) versionId: string, @Req() request: AuthenticatedRequest) {
    return apiSuccess(await this.products.transition(request.auth!, id, versionId, 'IN_REVIEW', request.requestId), request.requestId);
  }

  @Post(':id/versions/:versionId/approve')
  @RequirePermissions('approvals.manage')
  @HttpCode(200)
  async approve(@Param('id', ParseUUIDPipe) id: string, @Param('versionId', ParseUUIDPipe) versionId: string, @Req() request: AuthenticatedRequest) {
    return apiSuccess(await this.products.transition(request.auth!, id, versionId, 'APPROVED', request.requestId), request.requestId);
  }

  @Post(':id/versions/:versionId/reject')
  @RequirePermissions('approvals.manage')
  @HttpCode(200)
  async reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('versionId', ParseUUIDPipe) versionId: string,
    @Body() body: RejectDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return apiSuccess(await this.products.transition(request.auth!, id, versionId, 'REJECTED', request.requestId, body.reason), request.requestId);
  }

  @Post(':id/versions/:versionId/publish')
  @RequirePermissions('products.publish')
  @HttpCode(200)
  async publish(@Param('id', ParseUUIDPipe) id: string, @Param('versionId', ParseUUIDPipe) versionId: string, @Req() request: AuthenticatedRequest) {
    return apiSuccess(await this.products.transition(request.auth!, id, versionId, 'PUBLISHED', request.requestId), request.requestId);
  }

  @Post(':id/versions/:versionId/archive')
  @RequirePermissions('products.write')
  @HttpCode(200)
  async archiveVersion(@Param('id', ParseUUIDPipe) id: string, @Param('versionId', ParseUUIDPipe) versionId: string, @Req() request: AuthenticatedRequest) {
    return apiSuccess(await this.products.transition(request.auth!, id, versionId, 'ARCHIVED', request.requestId), request.requestId);
  }

  @Post(':id/versions/:versionId/restore')
  @RequirePermissions('products.write')
  @HttpCode(201)
  async restoreVersion(@Param('id', ParseUUIDPipe) id: string, @Param('versionId', ParseUUIDPipe) versionId: string, @Req() request: AuthenticatedRequest) {
    return apiSuccess(await this.products.restoreVersion(request.auth!, id, versionId, request.requestId), request.requestId);
  }

  @Get(':id/icps')
  @RequirePermissions('products.read')
  async icps(@Param('id', ParseUUIDPipe) id: string, @Query('versionId') versionId: string | undefined, @Req() request: AuthenticatedRequest) {
    return apiSuccess(await this.products.listIcps(request.auth!, id, versionId || undefined), request.requestId);
  }

  @Post(':id/icps')
  @RequirePermissions('products.write')
  @HttpCode(201)
  async addIcp(@Param('id', ParseUUIDPipe) id: string, @Body() body: IcpBody, @Req() request: AuthenticatedRequest) {
    return apiSuccess(await this.products.addIcp(request.auth!, id, body, request.requestId), request.requestId);
  }

  @Patch(':id/icps/:icpId')
  @RequirePermissions('products.write')
  async updateIcp(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('icpId', ParseUUIDPipe) icpId: string,
    @Body() body: IcpBody,
    @Req() request: AuthenticatedRequest,
  ) {
    return apiSuccess(await this.products.updateIcp(request.auth!, id, icpId, body, request.requestId), request.requestId);
  }

  @Post(':id/icps/:icpId/duplicate')
  @RequirePermissions('products.write')
  @HttpCode(201)
  async duplicateIcp(@Param('id', ParseUUIDPipe) id: string, @Param('icpId', ParseUUIDPipe) icpId: string, @Req() request: AuthenticatedRequest) {
    return apiSuccess(await this.products.duplicateIcp(request.auth!, id, icpId, request.requestId), request.requestId);
  }

  @Post(':id/icps/:icpId/archive')
  @RequirePermissions('products.write')
  async archiveIcp(@Param('id', ParseUUIDPipe) id: string, @Param('icpId', ParseUUIDPipe) icpId: string, @Req() request: AuthenticatedRequest) {
    return apiSuccess(await this.products.archiveIcp(request.auth!, id, icpId, request.requestId), request.requestId);
  }

  @Get(':id/knowledge')
  @RequirePermissions('products.read')
  async knowledge(@Param('id', ParseUUIDPipe) id: string, @Req() request: AuthenticatedRequest) {
    return apiSuccess(await this.products.documents(request.auth!, id), request.requestId);
  }

  @Post(':id/knowledge')
  @RequirePermissions('products.write')
  @HttpCode(201)
  async upload(@Param('id', ParseUUIDPipe) id: string, @Body() body: UploadDocumentDto, @Req() request: AuthenticatedRequest) {
    return apiSuccess(await this.products.upload(request.auth!, id, body, request.requestId), request.requestId);
  }

  @Post(':id/knowledge/search')
  @RequirePermissions('products.read')
  @HttpCode(200)
  async search(@Param('id', ParseUUIDPipe) id: string, @Body() body: SearchKnowledgeDto, @Req() request: AuthenticatedRequest) {
    return apiSuccess(await this.products.search(request.auth!, id, body), request.requestId);
  }

  @Get(':id/knowledge/:documentId')
  @RequirePermissions('products.read')
  async document(@Param('id', ParseUUIDPipe) id: string, @Param('documentId', ParseUUIDPipe) documentId: string, @Req() request: AuthenticatedRequest) {
    return apiSuccess(await this.products.document(request.auth!, id, documentId), request.requestId);
  }

  @Get(':id/knowledge/:documentId/download')
  @RequirePermissions('products.read')
  async download(@Param('id', ParseUUIDPipe) id: string, @Param('documentId', ParseUUIDPipe) documentId: string, @Req() request: AuthenticatedRequest) {
    const file = await this.products.download(request.auth!, id, documentId);
    return new StreamableFile(file.bytes, {
      type: file.contentType,
      disposition: `attachment; filename="${file.fileName}"`,
      length: file.bytes.length,
    });
  }

  @Post(':id/knowledge/:documentId/approve')
  @RequirePermissions('approvals.manage')
  @HttpCode(200)
  async approveDocument(@Param('id', ParseUUIDPipe) id: string, @Param('documentId', ParseUUIDPipe) documentId: string, @Req() request: AuthenticatedRequest) {
    return apiSuccess(await this.products.reviewDocument(request.auth!, id, documentId, 'APPROVED', request.requestId), request.requestId);
  }

  @Post(':id/knowledge/:documentId/reject')
  @RequirePermissions('approvals.manage')
  @HttpCode(200)
  async rejectDocument(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Body() body: RejectDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return apiSuccess(await this.products.reviewDocument(request.auth!, id, documentId, 'REJECTED', request.requestId, body.reason), request.requestId);
  }

  @Post(':id/knowledge/:documentId/retry')
  @RequirePermissions('products.write')
  @HttpCode(200)
  async retry(@Param('id', ParseUUIDPipe) id: string, @Param('documentId', ParseUUIDPipe) documentId: string, @Req() request: AuthenticatedRequest) {
    return apiSuccess(await this.products.reprocess(request.auth!, id, documentId, request.requestId, true), request.requestId);
  }

  @Post(':id/knowledge/:documentId/reprocess')
  @RequirePermissions('products.write')
  @HttpCode(200)
  async reprocess(@Param('id', ParseUUIDPipe) id: string, @Param('documentId', ParseUUIDPipe) documentId: string, @Req() request: AuthenticatedRequest) {
    return apiSuccess(await this.products.reprocess(request.auth!, id, documentId, request.requestId, false), request.requestId);
  }

  @Delete(':id/knowledge/:documentId')
  @RequirePermissions('products.write')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string, @Param('documentId', ParseUUIDPipe) documentId: string, @Req() request: AuthenticatedRequest) {
    await this.products.removeDocument(request.auth!, id, documentId, request.requestId);
  }

  @Post(':id/context/preview')
  @RequirePermissions('products.read')
  @HttpCode(200)
  async preview(@Param('id', ParseUUIDPipe) id: string, @Body() body: ContextPreviewDto, @Req() request: AuthenticatedRequest) {
    return apiSuccess(await this.products.preview(request.auth!, id, body), request.requestId);
  }

  @Get(':id')
  @RequirePermissions('products.read')
  async get(@Param('id', ParseUUIDPipe) id: string, @Req() request: AuthenticatedRequest) {
    return apiSuccess(await this.products.get(request.auth!, id), request.requestId);
  }

  @Patch(':id')
  @RequirePermissions('products.write')
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() body: ProductBody, @Req() request: AuthenticatedRequest) {
    return apiSuccess(await this.products.update(request.auth!, id, body, request.requestId), request.requestId);
  }

  @Post(':id/duplicate')
  @RequirePermissions('products.write')
  @HttpCode(201)
  async duplicate(@Param('id', ParseUUIDPipe) id: string, @Req() request: AuthenticatedRequest) {
    return apiSuccess(await this.products.duplicate(request.auth!, id, request.requestId), request.requestId);
  }

  @Post(':id/archive')
  @RequirePermissions('products.write')
  async archive(@Param('id', ParseUUIDPipe) id: string, @Req() request: AuthenticatedRequest) {
    return apiSuccess(await this.products.archive(request.auth!, id, request.requestId), request.requestId);
  }

  @Post(':id/restore')
  @RequirePermissions('products.write')
  async restore(@Param('id', ParseUUIDPipe) id: string, @Req() request: AuthenticatedRequest) {
    return apiSuccess(await this.products.restore(request.auth!, id, request.requestId), request.requestId);
  }
}
