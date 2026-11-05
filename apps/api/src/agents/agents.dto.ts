import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';

export class AgentPageDto {
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
  @MaxLength(200)
  q?: string;

  @IsOptional()
  @IsIn(['name', 'status', 'createdAt', 'state', 'triggerType', 'version'])
  sortBy?: string;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDirection?: 'asc' | 'desc';

  @IsOptional()
  @IsString()
  @MaxLength(40)
  status?: string;
}

export class AgentCreateDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(160)
  role!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  instructions?: string;

  @IsOptional()
  @IsUUID()
  modelConfigurationId?: string;

  @IsOptional()
  @IsUUID()
  defaultProductId?: string;
}

export class AgentChangeDto extends AgentCreateDto {
  @IsUUID()
  id!: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class RunCreateDto {
  @IsIn(['SCAN', 'TEST'])
  triggerType!: 'SCAN' | 'TEST';

  @IsOptional()
  @IsUUID()
  agentId?: string;

  @IsOptional()
  @IsUUID()
  productVersionId?: string;

  @IsOptional()
  @IsUUID()
  productId?: string;

  @IsOptional()
  @IsUUID()
  modelConfigurationId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  goal?: string;
}

export class ModelCreateDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsIn(['fake', 'openai_compatible', 'ollama'])
  provider!: 'fake' | 'openai_compatible' | 'ollama';

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  model!: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  baseUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(400)
  apiKey?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  inputPriceMinorPerMillion?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  outputPriceMinorPerMillion?: number;

  @IsOptional()
  @IsBoolean()
  allowPrivateHttp?: boolean;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class ModelChangeDto extends ModelCreateDto {
  @IsUUID()
  id!: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class ApprovalDecisionDto {
  @IsUUID()
  id!: string;

  @IsIn(['APPROVED', 'REJECTED', 'CHANGES_REQUESTED'])
  decision!: 'APPROVED' | 'REJECTED' | 'CHANGES_REQUESTED';

  @IsString()
  @MinLength(64)
  @MaxLength(64)
  payloadSha256!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;
}

export class PolicyCreateDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsIn(['A0', 'A1', 'A2', 'A3', 'A4'])
  autonomyLevel!: 'A0' | 'A1' | 'A2' | 'A3' | 'A4';

  @IsOptional()
  @IsString()
  @MaxLength(40)
  channel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  actionType?: string;
}

export class PolicyChangeDto extends PolicyCreateDto {
  @IsUUID()
  id!: string;
}
