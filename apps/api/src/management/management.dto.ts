import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { UpdateOrganizationDto } from '../identity/auth.dto';
import { IcpBody, ProductBody, UpdateVersionDto, UploadDocumentDto } from '../products/products.dto';

export class PageDto {
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
  @IsString()
  @MaxLength(120)
  q?: string;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDirection?: 'asc' | 'desc';
}

export class MemberListDto extends PageDto {
  @IsOptional()
  @IsIn(['displayName', 'email', 'role', 'status', 'createdAt'])
  sortBy?: 'displayName' | 'email' | 'role' | 'status' | 'createdAt';

  @IsOptional()
  @IsIn(['ACTIVE', 'INVITED', 'SUSPENDED', 'REMOVED'])
  status?: string;

  @IsOptional()
  @IsIn(['OWNER', 'ADMIN', 'SALES_MANAGER', 'SALES_AGENT', 'VIEWER'])
  role?: string;
}

export class OrganizationListDto extends PageDto {
  @IsOptional()
  @IsIn(['name', 'status'])
  sortBy?: 'name' | 'status';
}

export class AuditListDto extends PageDto {
  @IsOptional()
  @IsIn(['createdAt'])
  sortBy?: 'createdAt';
}

export class RecordIdDto {
  @IsUUID()
  id!: string;
}

export class OrganizationChangeDto extends UpdateOrganizationDto {
  @IsUUID()
  id!: string;
}

export class ProductParentDto {
  @IsUUID()
  productId!: string;
}

export class RecordIdsDto {
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('4', { each: true })
  ids!: string[];
}

export class MemberChangeDto {
  @IsUUID()
  userId!: string;

  @IsIn(['OWNER', 'ADMIN', 'SALES_MANAGER', 'SALES_AGENT', 'VIEWER'])
  role!: 'OWNER' | 'ADMIN' | 'SALES_MANAGER' | 'SALES_AGENT' | 'VIEWER';
}

export class ProductChangeDto extends ProductBody {
  @IsUUID()
  id!: string;
}

export class ProductChildDto extends PageDto {
  @IsUUID()
  productId!: string;

  @IsOptional()
  @IsIn(['DRAFT', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'PUBLISHED', 'SUPERSEDED', 'ARCHIVED'])
  status?: string;

  @IsOptional()
  @IsIn(['name', 'priority'])
  sortBy?: 'name' | 'priority';

  @IsOptional()
  @IsBoolean()
  archived?: boolean;
}

export class KnowledgeListDto extends PageDto {
  @IsUUID()
  productId!: string;

  @IsOptional()
  @IsIn(['VALIDATING', 'PROCESSING', 'EXTRACTED', 'INDEXED', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'FAILED', 'DELETED'])
  status?: string;

  @IsOptional()
  @IsIn(['pdf', 'docx', 'txt', 'md', 'markdown', 'html', 'htm'])
  fileType?: string;

  @IsOptional()
  @IsIn(['fileName', 'status', 'createdAt', 'updatedAt'])
  sortBy?: 'fileName' | 'status' | 'createdAt' | 'updatedAt';

  @IsOptional()
  @IsISO8601()
  createdAfter?: string;

  @IsOptional()
  @IsISO8601()
  createdBefore?: string;
}

export class ProductRecordDto {
  @IsUUID()
  productId!: string;

  @IsUUID()
  id!: string;
}

export class ProductRecordsDto {
  @IsUUID()
  productId!: string;

  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('4', { each: true })
  ids!: string[];
}

export class VersionChangeDto extends UpdateVersionDto {
  @IsUUID()
  productId!: string;

  @IsUUID()
  id!: string;
}

export class VersionActionDto {
  @IsUUID()
  productId!: string;

  @IsUUID()
  id!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class IcpCreateDto extends IcpBody {
  @IsUUID()
  productId!: string;
}

export class IcpChangeDto extends IcpBody {
  @IsUUID()
  productId!: string;

  @IsUUID()
  id!: string;
}

export class KnowledgeUploadDto extends UploadDocumentDto {
  @IsUUID()
  productId!: string;
}

export class KnowledgeDecisionDto {
  @IsUUID()
  productId!: string;

  @IsUUID()
  id!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
