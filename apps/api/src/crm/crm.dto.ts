import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { CRM_LEAD_STAGES, ELIGIBILITY_STATES, PROVENANCE } from '@salesos/shared';

export class CrmPageDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number;
  @IsOptional() @IsString() @MaxLength(120) q?: string;
  @IsOptional() @IsIn(['asc', 'desc']) sortDirection?: 'asc' | 'desc';
  @IsOptional() @IsBoolean() includeArchived?: boolean;
}

export class AccountListDto extends CrmPageDto {
  @IsOptional() @IsIn(['displayName', 'industry', 'country', 'createdAt', 'lifecycleStatus']) sortBy?: string;
  @IsOptional() @IsString() @MaxLength(120) industry?: string;
  @IsOptional() @IsString() @MaxLength(80) country?: string;
}

export class AccountBodyDto {
  @IsString() @MaxLength(200) legalName!: string;
  @IsOptional() @IsString() @MaxLength(200) displayName?: string;
  @IsOptional() @IsString() @MaxLength(300) website?: string;
  @IsOptional() @IsString() @MaxLength(120) industry?: string;
  @IsOptional() @IsString() @MaxLength(120) subindustry?: string;
  @IsOptional() @IsString() @MaxLength(80) businessModel?: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsOptional() @IsString() @MaxLength(80) sizeRange?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10000000) employeeEstimate?: number;
  @IsOptional() @IsIn(PROVENANCE) employeeStatus?: string;
  @IsOptional() @IsString() @MaxLength(80) revenueRange?: string;
  @IsOptional() @IsIn(PROVENANCE) revenueStatus?: string;
  @IsOptional() @IsString() @MaxLength(80) country?: string;
  @IsOptional() @IsString() @MaxLength(80) region?: string;
  @IsOptional() @IsString() @MaxLength(80) source?: string;
  @IsOptional() @IsIn(PROVENANCE) verificationStatus?: string;
}

export class AccountChangeDto extends AccountBodyDto {
  @IsUUID() id!: string;
  @Type(() => Number) @IsInt() @Min(1) revision!: number;
}

export class ContactListDto extends CrmPageDto {
  @IsOptional() @IsIn(['name', 'jobTitle', 'country', 'createdAt']) sortBy?: string;
  @IsOptional() @IsUUID() accountId?: string;
}

export class ContactBodyDto {
  @IsOptional() @IsUUID() accountId?: string;
  @IsString() @MaxLength(160) name!: string;
  @IsOptional() @IsString() @MaxLength(160) jobTitle?: string;
  @IsOptional() @IsString() @MaxLength(120) department?: string;
  @IsOptional() @IsString() @MaxLength(80) seniority?: string;
  @IsOptional() @IsString() @MaxLength(200) email?: string;
  @IsOptional() @IsString() @MaxLength(40) phone?: string;
  @IsOptional() @IsString() @MaxLength(300) profileUrl?: string;
  @IsOptional() @IsString() @MaxLength(80) country?: string;
  @IsOptional() @IsString() @MaxLength(80) timezone?: string;
  @IsOptional() @IsString() @MaxLength(80) contactRole?: string;
  @IsOptional() @IsIn(['UNKNOWN', 'DECISION_MAKER', 'INFLUENCER', 'USER']) decisionClass?: string;
  @IsOptional() @IsIn(PROVENANCE) verificationStatus?: string;
  @IsOptional() @IsIn(['UNKNOWN', 'KNOWN', 'WITHDRAWN']) consentState?: string;
  @IsOptional() @IsString() @MaxLength(80) source?: string;
}

export class ContactChangeDto extends ContactBodyDto {
  @IsUUID() id!: string;
  @Type(() => Number) @IsInt() @Min(1) revision!: number;
}

export class LeadListDto extends CrmPageDto {
  @IsOptional() @IsIn(['createdAt', 'stage', 'score', 'grade', 'eligibilityState']) sortBy?: string;
  @IsOptional() @IsIn(CRM_LEAD_STAGES) stage?: string;
  @IsOptional() @IsIn(['A', 'B', 'C', 'D', 'UNRATED']) grade?: string;
  @IsOptional() @IsUUID() productId?: string;
  @IsOptional() @IsString() @MaxLength(160) icpName?: string;
}

export class LeadBodyDto {
  @IsUUID() accountId!: string;
  @IsOptional() @IsUUID() contactId?: string;
  @IsOptional() @IsUUID() productId?: string;
  @IsOptional() @IsUUID() productVersionId?: string;
  @IsOptional() @IsString() @MaxLength(160) icpName?: string;
  @IsString() @MaxLength(40) sourceType!: string;
  @IsOptional() @IsString() @MaxLength(200) sourceRef?: string;
}

export class LeadChangeDto {
  @IsUUID() id!: string;
  @Type(() => Number) @IsInt() @Min(1) revision!: number;
  @IsOptional() @IsUUID() contactId?: string;
  @IsOptional() @IsString() @MaxLength(160) icpName?: string;
  @IsOptional() @IsString() @MaxLength(200) sourceRef?: string;
}

export class LeadStageDto {
  @IsUUID() id!: string;
  @Type(() => Number) @IsInt() @Min(1) revision!: number;
  @IsIn(CRM_LEAD_STAGES) stage!: string;
  @IsString() @MaxLength(300) reason!: string;
}

export class LeadBulkStageDto {
  @IsArray() @ArrayMaxSize(50) @IsUUID('4', { each: true }) ids!: string[];
  @IsIn(CRM_LEAD_STAGES) stage!: string;
  @IsString() @MaxLength(300) reason!: string;
}

export class AssignDto {
  @IsUUID() id!: string;
  @Type(() => Number) @IsInt() @Min(1) revision!: number;
  @IsOptional() @IsUUID() ownerUserId?: string;
  @IsString() @MaxLength(300) reason!: string;
}

export class BulkAssignDto {
  @IsArray() @ArrayMaxSize(25) @IsUUID('4', { each: true }) ids!: string[];
  @IsUUID() ownerUserId!: string;
  @IsString() @MaxLength(300) reason!: string;
}

export class TakeoverDto {
  @IsUUID() id!: string;
  @IsIn(['account', 'contact', 'lead']) subjectType!: 'account' | 'contact' | 'lead';
  @IsString() @MaxLength(300) reason!: string;
  @IsBoolean() active!: boolean;
}

export class RecordRevisionDto {
  @IsUUID() id!: string;
  @Type(() => Number) @IsInt() @Min(1) revision!: number;
}

export class ImportMapDto {
  @IsString() @MaxLength(40) field!: string;
  @IsString() @MaxLength(80) header!: string;
}

export class ImportPreviewDto {
  @IsString() @MaxLength(1_000_000) csv!: string;
  @IsOptional() @IsArray() @ArrayMaxSize(9) @ValidateNested({ each: true }) @Type(() => ImportMapDto) mapping?: ImportMapDto[];
}

export class ImportExecuteDto extends ImportPreviewDto {
  @IsString() @MaxLength(160) fileName!: string;
  @IsIn(['skip', 'create']) policy!: 'skip' | 'create';
  @IsString() @MaxLength(80) idempotencyKey!: string;
}

export class DiscoveryCompanyDto {
  @IsString() @MaxLength(200) name!: string;
  @IsOptional() @IsString() @MaxLength(300) website?: string;
  @IsOptional() @IsString() @MaxLength(120) industry?: string;
  @IsOptional() @IsString() @MaxLength(80) country?: string;
}

export class DiscoveryCreateDto {
  @IsIn(['manual', 'test']) providerId!: 'manual' | 'test';
  @IsOptional() @IsUUID() productId?: string;
  @IsOptional() @IsString() @MaxLength(160) icpName?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(25) maxCandidates?: number;
  @IsOptional() @IsArray() @ArrayMaxSize(25) @ValidateNested({ each: true }) @Type(() => DiscoveryCompanyDto) companies?: DiscoveryCompanyDto[];
}

export class QualifyDto {
  @IsUUID() id!: string;
  @IsOptional() @IsUUID() modelConfigurationId?: string;
}

export class OverrideDto {
  @IsUUID() id!: string;
  @Type(() => Number) @IsInt() @Min(1) revision!: number;
  @Type(() => Number) @IsInt() @Min(0) @Max(100) score!: number;
  @IsIn(['A', 'B', 'C', 'D', 'UNRATED']) grade!: string;
  @IsString() @MaxLength(500) reason!: string;
}

export class SuppressionBodyDto {
  @IsIn(['organization', 'contact', 'email', 'phone', 'account', 'channel']) scope!: string;
  @IsString() @MaxLength(80) reason!: string;
  @IsOptional() @IsString() @MaxLength(200) subject?: string;
  @IsOptional() @IsUUID() accountId?: string;
  @IsOptional() @IsUUID() contactId?: string;
  @IsOptional() @IsString() @MaxLength(40) channel?: string;
  @IsOptional() @IsString() @MaxLength(40) purpose?: string;
}

export class PolicyBodyDto {
  @IsOptional() @IsString() @MaxLength(80) timezone?: string;
  @IsArray() @ArrayMaxSize(7) @IsInt({ each: true }) weekdays!: number[];
  @Type(() => Number) @IsInt() @Min(0) @Max(1440) startMinute!: number;
  @Type(() => Number) @IsInt() @Min(0) @Max(1440) endMinute!: number;
  @IsArray() @ArrayMaxSize(40) @IsString({ each: true }) holidays!: string[];
  @Type(() => Number) @IsInt() @Min(0) @Max(168) minimumIntervalHours!: number;
  @Type(() => Number) @IsInt() @Min(0) @Max(100) maxAttempts!: number;
}

export class IdDto {
  @IsUUID() id!: string;
}

export class BulkIdsDto {
  @IsArray() @ArrayMaxSize(50) @IsUUID('4', { each: true }) ids!: string[];
}

export class SummaryDto {
  @IsOptional() @IsUUID() productId?: string;
  @IsOptional() @IsString() @MaxLength(40) from?: string;
  @IsOptional() @IsString() @MaxLength(40) to?: string;
}

export class EligibilityDto {
  @IsUUID() id!: string;
  @IsOptional() @IsIn(ELIGIBILITY_STATES) state?: string;
}
