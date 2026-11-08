import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { CAMPAIGN_STATES } from '@salesos/shared';

export class CampaignPageDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number;
  @IsOptional() @IsString() @MaxLength(120) q?: string;
  @IsOptional() @IsIn(['name', 'updatedAt', 'state', 'createdAt']) sortBy?: string;
  @IsOptional() @IsIn(['asc', 'desc']) sortDirection?: 'asc' | 'desc';
  @IsOptional() @IsIn(CAMPAIGN_STATES) state?: string;
}

export class CampaignBodyDto {
  @IsString() @MaxLength(160) name!: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsOptional() @IsString() @MaxLength(500) goal?: string;
  @IsOptional() @IsString() @MaxLength(40) campaignType?: string;
  @IsOptional() @IsString() @MaxLength(80) timeZone?: string;
  @IsOptional() @IsUUID() ownerUserId?: string;
  @IsOptional() @IsUUID() productVersionId?: string;
  @IsOptional() @IsString() @MaxLength(120) icpRef?: string;
}

export class CampaignChangeDto extends CampaignBodyDto {
  @IsUUID() id!: string;
  @Type(() => Number) @IsInt() @Min(1) revision!: number;
}

export class CampaignTransitionDto {
  @IsUUID() id!: string;
  @Type(() => Number) @IsInt() @Min(1) revision!: number;
  @IsIn(CAMPAIGN_STATES) state!: (typeof CAMPAIGN_STATES)[number];
}

export class CampaignIdDto {
  @IsUUID() id!: string;
}

export class CampaignIdsDto {
  @IsArray() @ArrayMaxSize(25) @IsUUID(undefined, { each: true }) ids!: string[];
}

export class SegmentBodyDto {
  @IsString() @MaxLength(160) name!: string;
  @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @IsIn(['DYNAMIC', 'SNAPSHOT']) kind!: 'DYNAMIC' | 'SNAPSHOT';
  @IsObject() filter!: Record<string, unknown>;
}

export class SegmentChangeDto {
  @IsUUID() id!: string;
  @Type(() => Number) @IsInt() @Min(1) revision!: number;
  @IsString() @MaxLength(160) name!: string;
  @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @IsObject() filter!: Record<string, unknown>;
}

export class SegmentPreviewDto {
  @IsObject() filter!: Record<string, unknown>;
}

export class AssignSegmentDto {
  @IsUUID() id!: string;
  @Type(() => Number) @IsInt() @Min(1) revision!: number;
  @IsUUID() segmentId!: string;
}

export class SequenceStepDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(12) position!: number;
  @IsString() @MaxLength(40) stepType!: string;
  @IsObject() config!: Record<string, unknown>;
}

export class SequenceBodyDto {
  @IsString() @MaxLength(160) name!: string;
  @IsOptional() @IsString() @MaxLength(80) timeZone?: string;
  @IsArray() @ArrayMaxSize(12) @ValidateNested({ each: true }) @Type(() => SequenceStepDto) steps!: SequenceStepDto[];
}

export class SequenceStepsDto {
  @IsUUID() id!: string;
  @IsArray() @ArrayMaxSize(12) @ValidateNested({ each: true }) @Type(() => SequenceStepDto) steps!: SequenceStepDto[];
}

export class AssignSequenceDto {
  @IsUUID() id!: string;
  @Type(() => Number) @IsInt() @Min(1) revision!: number;
  @IsUUID() sequenceId!: string;
}

export class TemplateBodyDto {
  @IsString() @MaxLength(160) name!: string;
  @IsString() @MaxLength(200) subject!: string;
  @IsString() @MaxLength(8000) bodyText!: string;
  @IsOptional() @IsString() @MaxLength(8000) bodyHtml?: string;
  @IsOptional() @IsString() @MaxLength(16) locale?: string;
  @IsOptional() @IsUUID() productId?: string;
}

export class ApprovalRequestDto {
  @IsIn(['CONFIGURATION', 'AUDIENCE', 'SEQUENCE', 'TEMPLATE', 'DRAFT']) kind!: string;
  @IsUUID() subjectId!: string;
  @IsString() @MaxLength(80) versionRef!: string;
  @IsString() @MaxLength(80) digest!: string;
}

export class ApprovalDecisionDto {
  @IsUUID() id!: string;
  @IsIn(['APPROVED', 'REJECTED']) decision!: 'APPROVED' | 'REJECTED';
  @IsString() @MaxLength(80) digest!: string;
}

export class PersonalizeDto {
  @IsUUID() campaignId!: string;
  @IsUUID() leadId!: string;
  @IsOptional() @IsUUID() templateVersionId?: string;
  @IsOptional() @IsString() @MaxLength(4000) modelText?: string;
  @IsOptional() @IsString() @MaxLength(40) modelProvider?: string;
  @IsOptional() @IsString() @MaxLength(80) modelName?: string;
}

export class AnalyticsDto {
  @IsOptional() @IsUUID() campaignId?: string;
  @IsOptional() @IsUUID() ownerUserId?: string;
  @IsOptional() @IsString() @MaxLength(40) from?: string;
  @IsOptional() @IsString() @MaxLength(40) to?: string;
}
