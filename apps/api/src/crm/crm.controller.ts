import { Body, Controller, HttpCode, Inject, Post, Req, UseGuards } from '@nestjs/common';
import { apiSuccess } from '@salesos/shared';
import { PermissionGuard, SessionGuard, type AuthenticatedRequest } from '../identity/auth.guard';
import { RequirePermissions } from '../identity/require-permissions';
import {
  AccountBodyDto,
  AccountChangeDto,
  AccountListDto,
  AssignDto,
  BulkAssignDto,
  BulkIdsDto,
  ContactBodyDto,
  ContactChangeDto,
  ContactListDto,
  DiscoveryCreateDto,
  IdDto,
  ImportExecuteDto,
  ImportPreviewDto,
  LeadBodyDto,
  LeadBulkStageDto,
  LeadChangeDto,
  LeadListDto,
  LeadStageDto,
  OverrideDto,
  PolicyBodyDto,
  QualifyDto,
  SummaryDto,
  SuppressionBodyDto,
  TakeoverDto,
} from './crm.dto';
import { CrmService } from './crm.service';

@Controller('management')
@UseGuards(SessionGuard, PermissionGuard)
export class CrmController {
  constructor(@Inject(CrmService) private readonly crm: CrmService) {}

  @Post('accounts/list') @HttpCode(200) @RequirePermissions('crm.accounts.read')
  accounts(@Body() body: AccountListDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.crm.listAccounts(request.auth!, body), request.requestId);
  }

  @Post('accounts/get') @HttpCode(200) @RequirePermissions('crm.accounts.read')
  account(@Body() body: IdDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.crm.accountRecord(request.auth!, body.id), request.requestId);
  }

  @Post('accounts/create') @HttpCode(200) @RequirePermissions('crm.accounts.write')
  createAccount(@Body() body: AccountBodyDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.crm.createAccount(request.auth!, body, request.requestId), request.requestId);
  }

  @Post('accounts/update') @HttpCode(200) @RequirePermissions('crm.accounts.write')
  updateAccount(@Body() body: AccountChangeDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.crm.updateAccount(request.auth!, body, request.requestId), request.requestId);
  }

  @Post('accounts/assign') @HttpCode(200) @RequirePermissions('crm.accounts.write')
  assignAccount(@Body() body: AssignDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.crm.assignAccount(request.auth!, body, request.requestId), request.requestId);
  }

  @Post('accounts/archive') @HttpCode(200) @RequirePermissions('crm.accounts.write')
  archiveAccounts(@Body() body: BulkIdsDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.crm.archiveAccounts(request.auth!, body, request.requestId), request.requestId);
  }

  @Post('contacts/list') @HttpCode(200) @RequirePermissions('crm.contacts.read')
  contacts(@Body() body: ContactListDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.crm.listContacts(request.auth!, body), request.requestId);
  }

  @Post('contacts/get') @HttpCode(200) @RequirePermissions('crm.contacts.read')
  contact(@Body() body: IdDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.crm.contactRecord(request.auth!, body.id), request.requestId);
  }

  @Post('contacts/create') @HttpCode(200) @RequirePermissions('crm.contacts.write')
  createContact(@Body() body: ContactBodyDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.crm.createContact(request.auth!, body, request.requestId), request.requestId);
  }

  @Post('contacts/update') @HttpCode(200) @RequirePermissions('crm.contacts.write')
  updateContact(@Body() body: ContactChangeDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.crm.updateContact(request.auth!, body, request.requestId), request.requestId);
  }

  @Post('leads/summary') @HttpCode(200) @RequirePermissions('crm.leads.read')
  summary(@Body() body: SummaryDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.crm.summary(request.auth!, body), request.requestId);
  }

  @Post('leads/list') @HttpCode(200) @RequirePermissions('crm.leads.read')
  leads(@Body() body: LeadListDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.crm.listLeads(request.auth!, body), request.requestId);
  }

  @Post('leads/get') @HttpCode(200) @RequirePermissions('crm.leads.read')
  lead(@Body() body: IdDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.crm.leadRecord(request.auth!, body.id), request.requestId);
  }

  @Post('leads/create') @HttpCode(200) @RequirePermissions('crm.leads.write')
  createLead(@Body() body: LeadBodyDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.crm.createLead(request.auth!, body, request.requestId), request.requestId);
  }

  @Post('leads/update') @HttpCode(200) @RequirePermissions('crm.leads.write')
  updateLead(@Body() body: LeadChangeDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.crm.updateLead(request.auth!, body, request.requestId), request.requestId);
  }

  @Post('leads/stage') @HttpCode(200) @RequirePermissions('crm.leads.write')
  stage(@Body() body: LeadStageDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.crm.transitionLead(request.auth!, body, request.requestId), request.requestId);
  }

  @Post('leads/bulk-stage') @HttpCode(200) @RequirePermissions('crm.leads.write')
  bulkStage(@Body() body: LeadBulkStageDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.crm.bulkTransition(request.auth!, body, request.requestId), request.requestId);
  }

  @Post('contacts/assign') @HttpCode(200) @RequirePermissions('crm.contacts.write')
  assignContact(@Body() body: AssignDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.crm.assignContact(request.auth!, body, request.requestId), request.requestId);
  }

  @Post('leads/assign') @HttpCode(200) @RequirePermissions('crm.leads.assign')
  assign(@Body() body: AssignDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.crm.assignLead(request.auth!, body, request.requestId), request.requestId);
  }

  @Post('leads/bulk-assign') @HttpCode(200) @RequirePermissions('crm.leads.assign')
  bulkAssign(@Body() body: BulkAssignDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.crm.bulkAssignLeads(request.auth!, body, request.requestId), request.requestId);
  }

  @Post('ownership/takeover') @HttpCode(200) @RequirePermissions('crm.leads.assign')
  takeover(@Body() body: TakeoverDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.crm.takeover(request.auth!, body, request.requestId), request.requestId);
  }

  @Post('lead-imports/template') @HttpCode(200) @RequirePermissions('crm.leads.import')
  template(@Req() request: AuthenticatedRequest) {
    return apiSuccess(this.crm.importTemplate(), request.requestId);
  }

  @Post('lead-imports/preview') @HttpCode(200) @RequirePermissions('crm.leads.import')
  preview(@Body() body: ImportPreviewDto, @Req() request: AuthenticatedRequest) {
    return apiSuccess(this.crm.previewImport(body), request.requestId);
  }

  @Post('lead-imports/execute') @HttpCode(200) @RequirePermissions('crm.leads.import')
  execute(@Body() body: ImportExecuteDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.crm.executeImport(request.auth!, body, request.requestId), request.requestId);
  }

  @Post('lead-imports/list') @HttpCode(200) @RequirePermissions('crm.leads.import')
  listImports(@Body() body: AccountListDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.crm.listImports(request.auth!, body), request.requestId);
  }

  @Post('lead-imports/get') @HttpCode(200) @RequirePermissions('crm.leads.import')
  importRecord(@Body() body: IdDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.crm.importRecord(request.auth!, body.id), request.requestId);
  }

  @Post('lead-imports/errors') @HttpCode(200) @RequirePermissions('crm.leads.import')
  errors(@Body() body: IdDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.crm.importErrors(request.auth!, body.id), request.requestId);
  }

  @Post('lead-imports/retry') @HttpCode(200) @RequirePermissions('crm.leads.import')
  retry(@Body() body: IdDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.crm.retryImport(request.auth!, body.id, request.requestId), request.requestId);
  }

  @Post('discovery/providers') @HttpCode(200) @RequirePermissions('crm.leads.discover')
  providers(@Req() request: AuthenticatedRequest) {
    return apiSuccess(this.crm.discoveryProviders(), request.requestId);
  }

  @Post('discovery/create') @HttpCode(200) @RequirePermissions('crm.leads.discover')
  createDiscovery(@Body() body: DiscoveryCreateDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.crm.createDiscovery(request.auth!, body, request.requestId), request.requestId);
  }

  @Post('discovery/list') @HttpCode(200) @RequirePermissions('crm.leads.discover')
  listDiscovery(@Body() body: AccountListDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.crm.listDiscovery(request.auth!, body), request.requestId);
  }

  @Post('discovery/get') @HttpCode(200) @RequirePermissions('crm.leads.discover')
  discovery(@Body() body: IdDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.crm.discoveryRecord(request.auth!, body.id), request.requestId);
  }

  @Post('discovery/cancel') @HttpCode(200) @RequirePermissions('crm.leads.discover')
  cancel(@Body() body: IdDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.crm.cancelDiscovery(request.auth!, body.id, request.requestId), request.requestId);
  }

  @Post('discovery/promote') @HttpCode(200) @RequirePermissions('crm.leads.discover')
  promote(@Body() body: IdDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.crm.promoteCandidate(request.auth!, body.id, request.requestId), request.requestId);
  }

  @Post('qualification/run') @HttpCode(200) @RequirePermissions('crm.leads.qualify')
  qualify(@Body() body: QualifyDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.crm.qualify(request.auth!, body, request.requestId), request.requestId);
  }

  @Post('qualification/override') @HttpCode(200) @RequirePermissions('crm.leads.qualify')
  override(@Body() body: OverrideDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.crm.overrideScore(request.auth!, body, request.requestId), request.requestId);
  }

  @Post('eligibility/evaluate') @HttpCode(200) @RequirePermissions('crm.leads.read')
  eligibility(@Body() body: IdDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.crm.evaluateEligibility(request.auth!, body.id, request.requestId), request.requestId);
  }

  @Post('suppression/list') @HttpCode(200) @RequirePermissions('crm.suppression.read')
  suppressions(@Body() body: AccountListDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.crm.listSuppressions(request.auth!, body), request.requestId);
  }

  @Post('suppression/create') @HttpCode(200) @RequirePermissions('crm.suppression.manage')
  createSuppression(@Body() body: SuppressionBodyDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.crm.createSuppression(request.auth!, body, request.requestId), request.requestId);
  }

  @Post('suppression/get') @HttpCode(200) @RequirePermissions('crm.suppression.read')
  suppression(@Body() body: IdDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.crm.suppressionRecord(request.auth!, body.id), request.requestId);
  }

  @Post('suppression/remove') @HttpCode(200) @RequirePermissions('crm.suppression.manage')
  removeSuppression(@Body() body: IdDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.crm.removeSuppression(request.auth!, body.id, request.requestId), request.requestId);
  }

  @Post('duplicates/list') @HttpCode(200) @RequirePermissions('crm.leads.read')
  duplicates(@Body() body: AccountListDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.crm.listDuplicates(request.auth!, body), request.requestId);
  }

  @Post('duplicates/get') @HttpCode(200) @RequirePermissions('crm.leads.read')
  duplicate(@Body() body: IdDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.crm.duplicateRecord(request.auth!, body.id), request.requestId);
  }

  @Post('duplicates/merge') @HttpCode(200) @RequirePermissions('crm.leads.merge')
  merge(@Body() body: IdDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.crm.mergeDuplicate(request.auth!, body.id, request.requestId), request.requestId);
  }

  @Post('contact-policies/get') @HttpCode(200) @RequirePermissions('crm.leads.read')
  policy(@Req() request: AuthenticatedRequest) {
    return this.ok(this.crm.policy(request.auth!), request.requestId);
  }

  @Post('contact-policies/update') @HttpCode(200) @RequirePermissions('crm.contact_policy.manage')
  savePolicy(@Body() body: PolicyBodyDto, @Req() request: AuthenticatedRequest) {
    return this.ok(this.crm.savePolicy(request.auth!, body, request.requestId), request.requestId);
  }

  private ok<T>(value: Promise<T> | T, requestId: string) {
    return Promise.resolve(value).then((data) => apiSuccess(data, requestId));
  }
}
