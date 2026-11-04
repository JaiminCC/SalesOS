import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsISO8601, IsObject, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import { PRODUCT_TYPES } from '@salesos/shared';

export class ListProductsQuery {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  @IsOptional()
  @IsIn(PRODUCT_TYPES)
  productType?: (typeof PRODUCT_TYPES)[number];

  @IsOptional()
  @IsIn(['ACTIVE', 'ARCHIVED'])
  status?: 'ACTIVE' | 'ARCHIVED';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;

  @IsOptional()
  @IsIn(['name', 'productType', 'status', 'createdAt', 'updatedAt'])
  sortBy?: 'name' | 'productType' | 'status' | 'createdAt' | 'updatedAt';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDirection?: 'asc' | 'desc';
}

export class ProductBody {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name?: string;

  @IsOptional()
  @IsIn(PRODUCT_TYPES)
  productType?: (typeof PRODUCT_TYPES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(120)
  category?: string;

  @IsOptional()
  @IsString()
  @MaxLength(400)
  shortDescription?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8000)
  detailedDescription?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  website?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  tags?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  targetMarkets?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(16, { each: true })
  languages?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;

  @IsOptional()
  @IsISO8601()
  expectedUpdatedAt?: string;
}

export class CreateProductDto {
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name!: string;

  @IsIn(PRODUCT_TYPES)
  productType!: (typeof PRODUCT_TYPES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(120)
  category?: string;

  @IsOptional()
  @IsString()
  @MaxLength(400)
  shortDescription?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8000)
  detailedDescription?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  website?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  tags?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  targetMarkets?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(16, { each: true })
  languages?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;
}

export class UpdateVersionDto {
  @IsInt()
  @Min(1)
  revision!: number;

  @IsOptional()
  @IsArray()
  icps?: unknown[];

  @IsOptional()
  @IsObject()
  positioning?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  pricing?: Record<string, unknown>;
}

export class UploadDocumentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(180)
  fileName!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(12_000_000)
  contentBase64!: string;

  @IsOptional()
  @IsUUID()
  replacesDocumentId?: string;
}

export class SearchKnowledgeDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  query!: string;

  @IsOptional()
  @IsIn(['keyword', 'semantic'])
  mode?: 'keyword' | 'semantic';

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  documentIds?: string[];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  limit?: number;
}

export class ContextPreviewDto extends SearchKnowledgeDto {
  @IsOptional()
  @IsUUID()
  versionId?: string;
}

export class RejectDto {
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

export class ProductDefaultsDto {
  @IsOptional()
  @IsObject()
  positioning?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  pricing?: Record<string, unknown>;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(3650)
  knowledgeRetentionDays?: number;

  @IsOptional()
  @IsISO8601()
  expectedUpdatedAt?: string;
}

export class IcpBody {
  @IsOptional()
  @IsString()
  @MaxLength(160)
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  priority?: number;

  @IsOptional()
  @IsBoolean()
  archived?: boolean;

  @IsOptional()
  @IsArray()
  industries?: unknown[];

  @IsOptional()
  @IsArray()
  companySizes?: unknown[];

  @IsOptional()
  @IsArray()
  revenueRanges?: unknown[];

  @IsOptional()
  @IsArray()
  geographicMarkets?: unknown[];

  @IsOptional()
  @IsArray()
  countries?: unknown[];

  @IsOptional()
  @IsArray()
  regions?: unknown[];

  @IsOptional()
  @IsArray()
  businessModels?: unknown[];

  @IsOptional()
  @IsArray()
  technologyStack?: unknown[];

  @IsOptional()
  @IsArray()
  buyerTitles?: unknown[];

  @IsOptional()
  @IsArray()
  decisionMakerRoles?: unknown[];

  @IsOptional()
  @IsArray()
  departments?: unknown[];

  @IsOptional()
  @IsArray()
  painPoints?: unknown[];

  @IsOptional()
  @IsArray()
  buyingTriggers?: unknown[];

  @IsOptional()
  @IsArray()
  budgetCharacteristics?: unknown[];

  @IsOptional()
  @IsArray()
  urgencySignals?: unknown[];

  @IsOptional()
  @IsArray()
  qualificationRequirements?: unknown[];

  @IsOptional()
  @IsArray()
  exclusionCriteria?: unknown[];

  @IsOptional()
  @IsArray()
  negativeSignals?: unknown[];

  @IsOptional()
  @IsArray()
  languages?: unknown[];

  @IsOptional()
  @IsObject()
  customAttributes?: Record<string, unknown>;
}
